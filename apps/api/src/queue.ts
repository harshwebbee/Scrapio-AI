import { Queue } from "bullmq";
import { env } from "./config.js";

const redisUrl = new URL(env.redisUrl);
const db = redisUrl.pathname.replace("/", "");

export const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: db ? Number(db) : undefined,
  maxRetriesPerRequest: null
};

export const crawlQueue = new Queue("crawl", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: false,
    removeOnFail: false,
    backoff: {
      type: "exponential",
      delay: 5000
    }
  }
});
