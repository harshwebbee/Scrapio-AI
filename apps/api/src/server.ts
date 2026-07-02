import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import cors from "cors";
import express from "express";
import http from "node:http";
import type { Job } from "bullmq";
import { Server } from "socket.io";
import { env } from "./config.js";
import { ensureDatabaseSchema } from "./db.js";
import { ApiError, errorHandler, sendError } from "./errors.js";
import { checkPostgres, checkRedis, getSystemHealth } from "./health.js";
import {
  createCrawlRecord,
  getCrawlAnalytics,
  getCrawlDetail,
  getPersistedCrawlEvent,
  isPersistedCrawlCompleted,
  listCrawlPages,
  markCrawlFailed,
  searchCrawl,
  type PersistedCrawlEvent
} from "./persistence.js";
import { crawlQueue } from "./queue.js";
import { createCrawlSchema, type CreateCrawlInput } from "./schema.js";

await ensureDatabaseSchema().catch((error) => {
  console.warn("Database schema could not be initialized.", error);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "scrapio-api" });
});

app.get("/api/system/health", async (_req, res, next) => {
  try {
    const health = await getSystemHealth();
    res.status(health.ok ? 200 : 503).json(health);
  } catch (error) {
    next(error);
  }
});

app.post("/api/crawls", async (req, res, next) => {
  try {
    const input = createCrawlSchema.parse(req.body);
    const [redis, postgres] = await Promise.all([checkRedis(), checkPostgres()]);
    if (!redis.ok) {
      return sendError(
        res,
        new ApiError(
          503,
          "REDIS_UNAVAILABLE",
          "Crawls cannot start because Redis is offline.",
          redis.action ?? "Run `npm run infra:up`, then try again."
        )
      );
    }
    if (!postgres.ok) {
      return sendError(
        res,
        new ApiError(
          503,
          "DATABASE_UNAVAILABLE",
          "Crawls cannot start because PostgreSQL is offline.",
          postgres.action ?? "Run `npm run infra:up`, then try again."
        )
      );
    }

    await ensureDatabaseSchema();
    const crawlId = await createCrawlRecord(input);
    try {
      const job = await crawlQueue.add("crawl", input, { jobId: crawlId });
      res.status(201).json({ id: job.id, status: "queued" });
    } catch (error) {
      await markCrawlFailed(crawlId, error instanceof Error ? error.message : "Queue creation failed").catch(() => undefined);
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id", async (req, res, next) => {
  try {
    const event = await getCrawlEvent(req.params.id);
    if (!event) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/detail", async (req, res, next) => {
  try {
    const detail = await getCrawlDetail(req.params.id);
    if (!detail) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/pages", async (req, res, next) => {
  try {
    const detail = await getCrawlDetail(req.params.id);
    if (!detail) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    const pages = await listCrawlPages(req.params.id);
    res.json({ crawlId: req.params.id, pages });
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/analytics", async (req, res, next) => {
  try {
    const analytics = await getCrawlAnalytics(req.params.id);
    if (!analytics) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/search", async (req, res, next) => {
  try {
    const detail = await getCrawlDetail(req.params.id);
    if (!detail) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");

    const query = typeof req.query.q === "string" ? req.query.q : "";
    const results = await searchCrawl(req.params.id, query);
    res.json({ crawlId: req.params.id, query, results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/download", async (req, res, next) => {
  try {
    const job = await crawlQueue.getJob(req.params.id);
    const state = job ? await job.getState() : null;
    const isCompleted = state === "completed" || (!job && (await isPersistedCrawlCompleted(req.params.id)));
    if (!job && !isCompleted) {
      throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    }
    if (!isCompleted) {
      throw new ApiError(409, "EXPORT_NOT_READY", "The export is not ready yet.", "Wait for the crawl to finish.");
    }

    const exportDir = path.join(env.storageDir, req.params.id);
    if (!fs.existsSync(exportDir)) {
      throw new ApiError(404, "EXPORT_NOT_FOUND", "The export files are missing.", "Run the crawl again.");
    }

    res.attachment(`scrapio-export-${req.params.id}.zip`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (error) => next(error));
    archive.pipe(res);
    archive.directory(exportDir, "website-export");
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("watch:crawl", async (jobId: string) => {
    try {
      socket.join(jobId);
      const event = await getCrawlEvent(jobId);
      if (event) socket.emit("crawl:progress", event);
    } catch {
      socket.emit("crawl:error", {
        code: "REQUEST_FAILED",
        message: "Live progress is temporarily unavailable.",
        action: "Check Redis and refresh the page."
      });
    }
  });
});

setInterval(async () => {
  const rooms = [...io.sockets.adapter.rooms.keys()].filter((room) => !io.sockets.sockets.has(room));
  await Promise.all(
    rooms.map(async (jobId) => {
      try {
        const event = await getCrawlEvent(jobId);
        if (!event) return;
        io.to(jobId).emit("crawl:progress", event);
      } catch {
        io.to(jobId).emit("crawl:error", {
          code: "REQUEST_FAILED",
          message: "Live progress is temporarily unavailable.",
          action: "Check Redis and refresh the page."
        });
      }
    })
  );
}, 1000);

app.use(errorHandler);

async function getCrawlEvent(jobId: string): Promise<PersistedCrawlEvent | null> {
  const job = await crawlQueue.getJob(jobId);
  if (job) return formatJobEvent(job);
  return getPersistedCrawlEvent(jobId);
}

async function formatJobEvent(job: Job<CreateCrawlInput>): Promise<PersistedCrawlEvent> {
  return {
    id: String(job.id),
    status: await job.getState(),
    progress: job.progress && typeof job.progress === "object" ? (job.progress as Record<string, unknown>) : {},
    result: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null
  };
}

server.listen(env.port, () => {
  console.log(`Scrapio API listening on http://localhost:${env.port}`);
});
