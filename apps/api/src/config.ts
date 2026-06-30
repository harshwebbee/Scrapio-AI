import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  storageDir: path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "../../storage")
};
