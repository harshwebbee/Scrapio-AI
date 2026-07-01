import fs from "node:fs/promises";
import net from "node:net";
import { chromium } from "playwright";
import { env } from "./config.js";

export type ServiceHealth = {
  name: string;
  ok: boolean;
  message: string;
  action?: string;
};

export type SystemHealth = {
  ok: boolean;
  service: "scrapio-api";
  checks: ServiceHealth[];
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const checks = await Promise.all([checkRedis(), checkPostgres(), checkStorage(), checkPlaywright()]);
  return {
    ok: checks.every((check) => check.ok),
    service: "scrapio-api",
    checks
  };
}

export async function checkRedis(): Promise<ServiceHealth> {
  return checkTcpUrl("redis", env.redisUrl);
}

async function checkPostgres(): Promise<ServiceHealth> {
  if (!env.databaseUrl) {
    return {
      name: "postgres",
      ok: false,
      message: "PostgreSQL is not configured.",
      action: "Set DATABASE_URL or start local infrastructure with `npm run infra:up`."
    };
  }
  return checkTcpUrl("postgres", env.databaseUrl);
}

async function checkStorage(): Promise<ServiceHealth> {
  try {
    await fs.mkdir(env.storageDir, { recursive: true });
    await fs.access(env.storageDir);
    return { name: "storage", ok: true, message: env.storageDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage directory is not accessible";
    return { name: "storage", ok: false, message };
  }
}

async function checkPlaywright(): Promise<ServiceHealth> {
  try {
    const executablePath = chromium.executablePath();
    await fs.access(executablePath);
    return { name: "playwright", ok: true, message: executablePath };
  } catch {
    return {
      name: "playwright",
      ok: false,
      message: "Chromium is not installed.",
      action: "Run `npx playwright install chromium`."
    };
  }
}

async function checkTcpUrl(name: string, rawUrl: string): Promise<ServiceHealth> {
  try {
    const url = new URL(rawUrl);
    const port = Number(url.port || defaultPort(url.protocol));
    await connect(url.hostname, port);
    return { name, ok: true, message: `${url.hostname}:${port}` };
  } catch (error) {
    return {
      name,
      ok: false,
      message: `${label(name)} is not reachable.`,
      action: name === "redis" || name === "postgres" ? "Run `npm run infra:up`, then refresh." : undefined
    };
  }
}

function connect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1200);
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    });
    socket.once("error", reject);
  });
}

function defaultPort(protocol: string): number {
  if (protocol.startsWith("redis")) return 6379;
  if (protocol.startsWith("postgres")) return 5432;
  return 80;
}

function label(name: string): string {
  if (name === "redis") return "Redis";
  if (name === "postgres") return "PostgreSQL";
  return name;
}
