import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { env } from "./config.js";
import { ApiError, errorHandler, sendError } from "./errors.js";
import { checkRedis, getSystemHealth } from "./health.js";
import { crawlQueue } from "./queue.js";
import { createCrawlSchema } from "./schema.js";

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
    const redis = await checkRedis();
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
    const job = await crawlQueue.add("crawl", input);
    res.status(201).json({ id: job.id, status: "queued" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id", async (req, res, next) => {
  try {
    const job = await crawlQueue.getJob(req.params.id);
    if (!job) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    const state = await job.getState();
    const progress = job.progress || {};
    res.json({
      id: job.id,
      status: state,
      progress,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id/download", async (req, res, next) => {
  try {
    const job = await crawlQueue.getJob(req.params.id);
    if (!job) throw new ApiError(404, "CRAWL_NOT_FOUND", "That crawl could not be found.", "Start a new crawl.");
    const state = await job.getState();
    if (state !== "completed") {
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
      const job = await crawlQueue.getJob(jobId);
      if (job) {
        socket.emit("crawl:progress", {
          id: job.id,
          status: await job.getState(),
          progress: job.progress || {},
          result: job.returnvalue ?? null,
          failedReason: job.failedReason ?? null
        });
      }
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
        const job = await crawlQueue.getJob(jobId);
        if (!job) return;
        io.to(jobId).emit("crawl:progress", {
          id: job.id,
          status: await job.getState(),
          progress: job.progress || {},
          result: job.returnvalue ?? null,
          failedReason: job.failedReason ?? null
        });
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

server.listen(env.port, () => {
  console.log(`Scrapio API listening on http://localhost:${env.port}`);
});
