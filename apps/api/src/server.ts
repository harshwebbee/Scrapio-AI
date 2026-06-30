import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { env } from "./config.js";
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

app.post("/api/crawls", async (req, res, next) => {
  try {
    const input = createCrawlSchema.parse(req.body);
    const job = await crawlQueue.add("crawl", input);
    res.status(201).json({ id: job.id, status: "queued" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/crawls/:id", async (req, res, next) => {
  try {
    const job = await crawlQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Crawl not found" });
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
    if (!job) return res.status(404).json({ error: "Crawl not found" });
    const state = await job.getState();
    if (state !== "completed") return res.status(409).json({ error: "Export is not ready yet" });

    const exportDir = path.join(env.storageDir, req.params.id);
    if (!fs.existsSync(exportDir)) return res.status(404).json({ error: "Export files not found" });

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
  });
});

setInterval(async () => {
  const rooms = [...io.sockets.adapter.rooms.keys()].filter((room) => !io.sockets.sockets.has(room));
  await Promise.all(
    rooms.map(async (jobId) => {
      const job = await crawlQueue.getJob(jobId);
      if (!job) return;
      io.to(jobId).emit("crawl:progress", {
        id: job.id,
        status: await job.getState(),
        progress: job.progress || {},
        result: job.returnvalue ?? null,
        failedReason: job.failedReason ?? null
      });
    })
  );
}, 1000);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(400).json({ error: message });
});

server.listen(env.port, () => {
  console.log(`Scrapio API listening on http://localhost:${env.port}`);
});
