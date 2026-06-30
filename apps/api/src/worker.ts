import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";
import { runCrawl } from "@scrapio/scraper";
import { env } from "./config.js";
import { connection } from "./queue.js";
import type { CreateCrawlInput } from "./schema.js";

await fs.mkdir(env.storageDir, { recursive: true });

const worker = new Worker<CreateCrawlInput>(
  "crawl",
  async (job) => {
    const outputDir = path.join(env.storageDir, String(job.id));
    await fs.mkdir(outputDir, { recursive: true });
    await job.updateProgress({
      status: "running",
      pagesProcessed: 0,
      remainingQueue: 1,
      pagesCrawled: 0,
      assetsDownloaded: 0,
      imagesFound: 0,
      videosFound: 0,
      documentsFound: 0,
      totalContentSize: 0,
      message: "Starting crawl"
    });

    const result = await runCrawl(
      {
        ...job.data,
        outputDir
      },
      (progress) => job.updateProgress(progress)
    );

    return {
      website: result.website,
      crawl_date: result.crawl_date,
      pagesCrawled: result.pages.length,
      chunks: result.chunks.length,
      summary: result.summary
    };
  },
  {
    connection,
    concurrency: 2
  }
);

worker.on("completed", (job) => {
  console.log(`Crawl ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Crawl ${job?.id ?? "unknown"} failed`, error);
});

console.log("Scrapio worker ready");
