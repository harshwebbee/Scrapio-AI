import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type { AiChunk, CrawlResult, ExtractedAsset, ExtractedPage } from "@scrapio/scraper";
import { query, withTransaction } from "./db.js";
import type { CreateCrawlInput } from "./schema.js";

export type PersistedCrawlEvent = {
  id: string;
  status: string;
  progress: Record<string, unknown>;
  result: {
    pagesCrawled: number;
    chunks: number;
    summary: Record<string, unknown>;
  } | null;
  failedReason: string | null;
};

export async function createCrawlRecord(input: CreateCrawlInput): Promise<string> {
  const result = await query<{ id: string }>(
    `
      INSERT INTO crawls (url, status, depth, max_pages, export_type, domain_mode)
      VALUES ($1, 'queued', $2, $3, $4, $5)
      RETURNING id
    `,
    [input.url, String(input.depth), String(input.maxPages), input.exportType, input.domainMode]
  );

  return result.rows[0].id;
}

export async function markCrawlStarted(crawlId: string): Promise<void> {
  await query(
    `
      UPDATE crawls
      SET status = 'running',
          started_at = COALESCE(started_at, now()),
          failed_reason = NULL
      WHERE id = $1
    `,
    [crawlId]
  );
}

export async function markCrawlCompleted(crawlId: string): Promise<void> {
  await query(
    `
      UPDATE crawls
      SET status = 'completed',
          completed_at = now(),
          failed_reason = NULL
      WHERE id = $1
    `,
    [crawlId]
  );
}

export async function markCrawlFailed(crawlId: string, reason: string): Promise<void> {
  await query(
    `
      UPDATE crawls
      SET status = 'failed',
          completed_at = now(),
          failed_reason = $2
      WHERE id = $1
    `,
    [crawlId, reason.slice(0, 2000)]
  );
}

export async function getPersistedCrawlEvent(crawlId: string): Promise<PersistedCrawlEvent | null> {
  const result = await query<{
    id: string;
    status: string;
    failed_reason: string | null;
    summary: Record<string, unknown> | null;
  }>(
    `
      SELECT c.id,
             c.status,
             c.failed_reason,
             snapshot.summary
      FROM crawls c
      LEFT JOIN LATERAL (
        SELECT summary
        FROM crawl_snapshots
        WHERE crawl_id = c.id
        ORDER BY snapshot_number DESC
        LIMIT 1
      ) snapshot ON true
      WHERE c.id = $1
    `,
    [crawlId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const progress = row.summary ?? {};
  const pagesCrawled = Number(progress.pagesCrawled ?? progress.pagesProcessed ?? 0);
  const chunks = Number(progress.chunks ?? 0);

  return {
    id: row.id,
    status: row.status,
    progress,
    result:
      row.status === "completed"
        ? {
            pagesCrawled,
            chunks,
            summary: progress
          }
        : null,
    failedReason: row.failed_reason
  };
}

export async function isPersistedCrawlCompleted(crawlId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM crawls WHERE id = $1 AND status = 'completed')",
    [crawlId]
  );
  return result.rows[0]?.exists ?? false;
}

export async function persistCrawlResult(
  crawlId: string,
  result: CrawlResult,
  input: CreateCrawlInput
): Promise<void> {
  await withTransaction(async (client) => {
    await clearPreviousCrawlArtifacts(client, crawlId);

    const summary = {
      ...result.summary,
      chunks: result.chunks.length
    };
    const snapshotId = await createSnapshot(client, crawlId, summary);
    const pageIds = new Map<string, string>();

    for (const page of result.pages) {
      const pageId = await insertPage(client, crawlId, snapshotId, page);
      pageIds.set(page.url, pageId);
      pageIds.set(page.path, pageId);

      await insertPageVersion(client, pageId, snapshotId, page);
      await insertLinks(client, crawlId, pageId, page);
      await insertAssets(client, crawlId, pageId, result.outputDir, [
        ...page.images,
        ...page.videos,
        ...page.documents
      ]);
    }

    await insertChunks(client, pageIds, result.chunks);
    await client.query(
      `
        INSERT INTO exports (crawl_id, export_type, local_path)
        VALUES ($1, $2, $3)
      `,
      [crawlId, input.exportType, result.outputDir]
    );
  });
}

async function clearPreviousCrawlArtifacts(client: PoolClient, crawlId: string): Promise<void> {
  await client.query("DELETE FROM assets WHERE crawl_id = $1", [crawlId]);
  await client.query("DELETE FROM links WHERE crawl_id = $1", [crawlId]);
  await client.query(
    `
      DELETE FROM chunks
      WHERE page_id IN (SELECT id FROM pages WHERE crawl_id = $1)
    `,
    [crawlId]
  );
  await client.query("DELETE FROM page_versions WHERE page_id IN (SELECT id FROM pages WHERE crawl_id = $1)", [crawlId]);
  await client.query("DELETE FROM pages WHERE crawl_id = $1", [crawlId]);
  await client.query("DELETE FROM crawl_snapshots WHERE crawl_id = $1", [crawlId]);
  await client.query("DELETE FROM exports WHERE crawl_id = $1", [crawlId]);
}

async function createSnapshot(
  client: PoolClient,
  crawlId: string,
  summary: Record<string, unknown>
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO crawl_snapshots (crawl_id, snapshot_number, summary)
      VALUES ($1, 1, $2)
      RETURNING id
    `,
    [crawlId, JSON.stringify(summary)]
  );

  return result.rows[0].id;
}

async function insertPage(
  client: PoolClient,
  crawlId: string,
  snapshotId: string,
  page: ExtractedPage
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO pages (
        crawl_id,
        snapshot_id,
        url,
        canonical_url,
        title,
        content_hash,
        metadata_hash,
        markdown_path,
        json_path,
        word_count,
        status_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `,
    [
      crawlId,
      snapshotId,
      page.url,
      emptyToNull(page.metadata.canonical_url),
      page.title,
      sha256(page.content),
      sha256(JSON.stringify(page.metadata)),
      page.markdownPath ?? null,
      page.jsonPath ?? null,
      wordCount(page.content),
      page.statusCode ?? null
    ]
  );

  return result.rows[0].id;
}

async function insertPageVersion(
  client: PoolClient,
  pageId: string,
  snapshotId: string,
  page: ExtractedPage
): Promise<void> {
  await client.query(
    `
      INSERT INTO page_versions (
        page_id,
        snapshot_id,
        content_hash,
        metadata,
        headings,
        markdown_path,
        json_path
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      pageId,
      snapshotId,
      sha256(page.content),
      JSON.stringify(page.metadata),
      JSON.stringify(page.headings),
      page.markdownPath ?? null,
      page.jsonPath ?? null
    ]
  );
}

async function insertLinks(client: PoolClient, crawlId: string, pageId: string, page: ExtractedPage): Promise<void> {
  for (const link of page.links) {
    await client.query(
      `
        INSERT INTO links (crawl_id, source_page_id, target_url, text, link_type)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [crawlId, pageId, link.url, link.text, link.type]
    );
  }
}

async function insertAssets(
  client: PoolClient,
  crawlId: string,
  pageId: string,
  outputDir: string,
  assets: ExtractedAsset[]
): Promise<void> {
  for (const asset of assets) {
    const file = await getAssetFileDetails(outputDir, asset);
    await client.query(
      `
        INSERT INTO assets (
          crawl_id,
          page_id,
          asset_type,
          url,
          local_path,
          content_hash,
          byte_size
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [crawlId, pageId, asset.type, asset.url, asset.localPath ?? null, file.hash, file.byteSize]
    );
  }
}

async function insertChunks(client: PoolClient, pageIds: Map<string, string>, chunks: AiChunk[]): Promise<void> {
  for (const chunk of chunks) {
    const pageId = pageIds.get(chunk.page_url ?? chunk.page);
    if (!pageId) continue;

    await client.query(
      `
        INSERT INTO chunks (page_id, chunk_id, content, token_count)
        VALUES ($1, $2, $3, $4)
      `,
      [pageId, chunk.chunk_id, chunk.content, wordCount(chunk.content)]
    );
  }
}

async function getAssetFileDetails(
  outputDir: string,
  asset: ExtractedAsset
): Promise<{ hash: string | null; byteSize: number | null }> {
  if (!asset.localPath) return { hash: null, byteSize: null };

  const fullPath = path.resolve(outputDir, asset.localPath);
  if (!fullPath.startsWith(path.resolve(outputDir))) {
    return { hash: null, byteSize: null };
  }

  try {
    const data = await fs.readFile(fullPath);
    return {
      hash: sha256(data),
      byteSize: data.byteLength
    };
  } catch {
    return { hash: null, byteSize: null };
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value : null;
}
