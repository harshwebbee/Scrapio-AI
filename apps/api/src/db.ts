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
  await ensureSchemaMigrations();
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

async function ensureSchemaMigrations(): Promise<void> {
  await getPool().query("ALTER TABLE crawls ADD COLUMN IF NOT EXISTS chunk_size INTEGER NOT NULL DEFAULT 800");
  await getPool().query("ALTER TABLE crawls ADD COLUMN IF NOT EXISTS chunk_overlap INTEGER NOT NULL DEFAULT 100");
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS crawl_diffs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      baseline_crawl_id UUID REFERENCES crawls(id) ON DELETE SET NULL,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      new_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      removed_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      unchanged_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (crawl_id)
    )
  `);
  await getPool().query("CREATE INDEX IF NOT EXISTS crawl_diffs_crawl_id_idx ON crawl_diffs(crawl_id)");
}
