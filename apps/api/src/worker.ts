import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";
import { runCrawl } from "@scrapio/scraper";
import { env } from "./config.js";
import { ensureDatabaseSchema } from "./db.js";
import { markCrawlCompleted, markCrawlFailed, markCrawlStarted, persistCrawlResult } from "./persistence.js";
import { connection } from "./queue.js";
import type { CreateCrawlInput } from "./schema.js";

await fs.mkdir(env.storageDir, { recursive: true });
await ensureDatabaseSchema();

const worker = new Worker<CreateCrawlInput>(
  "crawl",
  async (job) => {
    const crawlId = String(job.id);
    const outputDir = path.join(env.storageDir, crawlId);

    try {
      await markCrawlStarted(crawlId);
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

      await persistCrawlResult(crawlId, result, job.data);
      await markCrawlCompleted(crawlId);

      return {
        website: result.website,
        crawl_date: result.crawl_date,
        pagesCrawled: result.pages.length,
        chunks: result.chunks.length,
        summary: {
          ...result.summary,
          chunks: result.chunks.length
        }
      };
    } catch (error) {
      await markCrawlFailed(crawlId, error instanceof Error ? error.message : "Crawl failed").catch(() => undefined);
      throw error;
    }
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
