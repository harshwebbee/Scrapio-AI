import fs from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "./config.js";

const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl
    })
  : null;

export function hasDatabaseConfig(): boolean {
  return Boolean(pool);
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (!pool) return;

  const schemaPath = await findSchemaPath();
  const schema = await fs.readFile(schemaPath, "utf8");
  await pool.query(schema);
}

export async function checkDatabaseConnection(): Promise<void> {
  await query("SELECT 1");
}

async function findSchemaPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "../../db/schema.sql"),
    path.resolve(process.cwd(), "db/schema.sql"),
    path.resolve(process.cwd(), "../db/schema.sql")
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next likely workspace location.
    }
  }

  throw new Error("Could not find db/schema.sql.");
}
