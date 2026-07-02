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

export type CrawlDiffPage = {
  url: string;
  title: string | null;
  contentHash: string | null;
  metadataHash: string | null;
  wordCount: number;
};

export type CrawlDiff = {
  baselineCrawlId: string | null;
  summary: {
    newPages: number;
    updatedPages: number;
    removedPages: number;
    unchangedPages: number;
  };
  newPages: CrawlDiffPage[];
  updatedPages: CrawlDiffPage[];
  removedPages: CrawlDiffPage[];
  unchangedPages: CrawlDiffPage[];
};

export type CrawlDetail = {
  id: string;
  url: string;
  status: string;
  depth: string;
  maxPages: string;
  exportType: string;
  domainMode: string;
  chunkSize: number;
  chunkOverlap: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedReason: string | null;
  summary: Record<string, unknown>;
  diff: CrawlDiff | null;
};

export type CrawlPageSummary = {
  id: string;
  url: string;
  title: string | null;
  canonicalUrl: string | null;
  contentHash: string | null;
  metadataHash: string | null;
  markdownPath: string | null;
  jsonPath: string | null;
  wordCount: number;
  statusCode: number | null;
  links: number;
  assets: number;
  chunks: number;
};

export type CrawlAnalytics = {
  totals: {
    pages: number;
    links: number;
    assets: number;
    chunks: number;
    words: number;
    bytes: number;
  };
  links: {
    internal: number;
    external: number;
  };
  assets: {
    images: number;
    videos: number;
    documents: number;
    bytes: number;
  };
  pages: {
    largest: CrawlPageSummary[];
    statusCodes: Array<{ statusCode: number | null; count: number }>;
  };
};

export type CrawlSearchResult = {
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  chunkId: string | null;
  snippet: string;
  matchType: "page" | "chunk";
};

export async function createCrawlRecord(input: CreateCrawlInput): Promise<string> {
  const result = await query<{ id: string }>(
    `
      INSERT INTO crawls (url, status, depth, max_pages, export_type, domain_mode, chunk_size, chunk_overlap)
      VALUES ($1, 'queued', $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      input.url,
      String(input.depth),
      String(input.maxPages),
      input.exportType,
      input.domainMode,
      input.chunkSize,
      input.chunkOverlap
    ]
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

    await persistCrawlDiff(client, crawlId);
  });
}

export async function getCrawlDetail(crawlId: string): Promise<CrawlDetail | null> {
  const result = await query<{
    id: string;
    url: string;
    status: string;
    depth: string;
    max_pages: string;
    export_type: string;
    domain_mode: string;
    chunk_size: number;
    chunk_overlap: number;
    created_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    failed_reason: string | null;
    summary: Record<string, unknown> | null;
    baseline_crawl_id: string | null;
    diff_summary: CrawlDiff["summary"] | null;
    new_pages: CrawlDiffPage[] | null;
    updated_pages: CrawlDiffPage[] | null;
    removed_pages: CrawlDiffPage[] | null;
    unchanged_pages: CrawlDiffPage[] | null;
  }>(
    `
      SELECT c.id,
             c.url,
             c.status,
             c.depth,
             c.max_pages,
             c.export_type,
             c.domain_mode,
             c.chunk_size,
             c.chunk_overlap,
             c.created_at,
             c.started_at,
             c.completed_at,
             c.failed_reason,
             snapshot.summary,
             diff.baseline_crawl_id,
             diff.summary AS diff_summary,
             diff.new_pages,
             diff.updated_pages,
             diff.removed_pages,
             diff.unchanged_pages
      FROM crawls c
      LEFT JOIN LATERAL (
        SELECT summary
        FROM crawl_snapshots
        WHERE crawl_id = c.id
        ORDER BY snapshot_number DESC
        LIMIT 1
      ) snapshot ON true
      LEFT JOIN crawl_diffs diff ON diff.crawl_id = c.id
      WHERE c.id = $1
    `,
    [crawlId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    status: row.status,
    depth: row.depth,
    maxPages: row.max_pages,
    exportType: row.export_type,
    domainMode: row.domain_mode,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    failedReason: row.failed_reason,
    summary: row.summary ?? {},
    diff: row.diff_summary
      ? {
          baselineCrawlId: row.baseline_crawl_id,
          summary: row.diff_summary,
          newPages: row.new_pages ?? [],
          updatedPages: row.updated_pages ?? [],
          removedPages: row.removed_pages ?? [],
          unchangedPages: row.unchanged_pages ?? []
        }
      : null
  };
}

export async function listCrawlPages(crawlId: string): Promise<CrawlPageSummary[]> {
  const result = await query<{
    id: string;
    url: string;
    title: string | null;
    canonical_url: string | null;
    content_hash: string | null;
    metadata_hash: string | null;
    markdown_path: string | null;
    json_path: string | null;
    word_count: number;
    status_code: number | null;
    links: string;
    assets: string;
    chunks: string;
  }>(
    `
      SELECT p.id,
             p.url,
             p.title,
             p.canonical_url,
             p.content_hash,
             p.metadata_hash,
             p.markdown_path,
             p.json_path,
             p.word_count,
             p.status_code,
             COUNT(DISTINCT l.id) AS links,
             COUNT(DISTINCT a.id) AS assets,
             COUNT(DISTINCT ch.id) AS chunks
      FROM pages p
      LEFT JOIN links l ON l.source_page_id = p.id
      LEFT JOIN assets a ON a.page_id = p.id
      LEFT JOIN chunks ch ON ch.page_id = p.id
      WHERE p.crawl_id = $1
      GROUP BY p.id
      ORDER BY p.word_count DESC, p.url ASC
    `,
    [crawlId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    canonicalUrl: row.canonical_url,
    contentHash: row.content_hash,
    metadataHash: row.metadata_hash,
    markdownPath: row.markdown_path,
    jsonPath: row.json_path,
    wordCount: row.word_count,
    statusCode: row.status_code,
    links: Number(row.links),
    assets: Number(row.assets),
    chunks: Number(row.chunks)
  }));
}

export async function getCrawlAnalytics(crawlId: string): Promise<CrawlAnalytics | null> {
  const crawlExists = await query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM crawls WHERE id = $1)", [crawlId]);
  if (!crawlExists.rows[0]?.exists) return null;

  const [totals, links, assets, statusCodes, largestPages] = await Promise.all([
    query<{
      pages: string;
      chunks: string;
      words: string;
      bytes: string;
    }>(
      `
        SELECT COUNT(DISTINCT p.id) AS pages,
               COUNT(DISTINCT ch.id) AS chunks,
               COALESCE((SELECT SUM(word_count) FROM pages WHERE crawl_id = $1), 0) AS words,
               COALESCE((SELECT SUM(octet_length(chunks.content))
                         FROM chunks
                         JOIN pages ON pages.id = chunks.page_id
                         WHERE pages.crawl_id = $1), 0) AS bytes
        FROM pages p
        LEFT JOIN chunks ch ON ch.page_id = p.id
        WHERE p.crawl_id = $1
      `,
      [crawlId]
    ),
    query<{ link_type: string; count: string }>(
      `
        SELECT link_type, COUNT(*) AS count
        FROM links
        WHERE crawl_id = $1
        GROUP BY link_type
      `,
      [crawlId]
    ),
    query<{ asset_type: string; count: string; bytes: string }>(
      `
        SELECT asset_type,
               COUNT(*) AS count,
               COALESCE(SUM(byte_size), 0) AS bytes
        FROM assets
        WHERE crawl_id = $1
        GROUP BY asset_type
      `,
      [crawlId]
    ),
    query<{ status_code: number | null; count: string }>(
      `
        SELECT status_code, COUNT(*) AS count
        FROM pages
        WHERE crawl_id = $1
        GROUP BY status_code
        ORDER BY status_code NULLS LAST
      `,
      [crawlId]
    ),
    listCrawlPages(crawlId)
  ]);

  const totalRow = totals.rows[0];
  const linkCounts = new Map(links.rows.map((row) => [row.link_type, Number(row.count)]));
  const assetCounts = new Map(assets.rows.map((row) => [row.asset_type, row]));

  return {
    totals: {
      pages: Number(totalRow?.pages ?? 0),
      links: [...linkCounts.values()].reduce((total, count) => total + count, 0),
      assets: assets.rows.reduce((total, row) => total + Number(row.count), 0),
      chunks: Number(totalRow?.chunks ?? 0),
      words: Number(totalRow?.words ?? 0),
      bytes: Number(totalRow?.bytes ?? 0)
    },
    links: {
      internal: linkCounts.get("internal") ?? 0,
      external: linkCounts.get("external") ?? 0
    },
    assets: {
      images: Number(assetCounts.get("image")?.count ?? 0),
      videos: Number(assetCounts.get("video")?.count ?? 0),
      documents: Number(assetCounts.get("document")?.count ?? 0),
      bytes: assets.rows.reduce((total, row) => total + Number(row.bytes), 0)
    },
    pages: {
      largest: largestPages.slice(0, 10),
      statusCodes: statusCodes.rows.map((row) => ({
        statusCode: row.status_code,
        count: Number(row.count)
      }))
    }
  };
}

export async function searchCrawl(crawlId: string, searchQuery: string): Promise<CrawlSearchResult[]> {
  const trimmed = searchQuery.trim();
  if (!trimmed) return [];

  const result = await query<{
    page_id: string;
    page_url: string;
    page_title: string | null;
    chunk_id: string | null;
    snippet: string;
    match_type: "page" | "chunk";
  }>(
    `
      SELECT *
      FROM (
        SELECT p.id AS page_id,
               p.url AS page_url,
               p.title AS page_title,
               NULL::text AS chunk_id,
               COALESCE(p.title, p.url) AS snippet,
               'page'::text AS match_type,
               0 AS rank
        FROM pages p
        WHERE p.crawl_id = $1
          AND (p.title ILIKE $2 ESCAPE '\\' OR p.url ILIKE $2 ESCAPE '\\')

        UNION ALL

        SELECT p.id AS page_id,
               p.url AS page_url,
               p.title AS page_title,
               ch.chunk_id,
               substring(ch.content from greatest(1, position(lower($3) in lower(ch.content)) - 90) for 240) AS snippet,
               'chunk'::text AS match_type,
               1 AS rank
        FROM chunks ch
        JOIN pages p ON p.id = ch.page_id
        WHERE p.crawl_id = $1
          AND ch.content ILIKE $2 ESCAPE '\\'
      ) matches
      ORDER BY rank, page_url, chunk_id NULLS FIRST
      LIMIT 25
    `,
    [crawlId, `%${escapeLikePattern(trimmed)}%`, trimmed]
  );

  return result.rows.map((row) => ({
    pageId: row.page_id,
    pageUrl: row.page_url,
    pageTitle: row.page_title,
    chunkId: row.chunk_id,
    snippet: row.snippet,
    matchType: row.match_type
  }));
}

async function clearPreviousCrawlArtifacts(client: PoolClient, crawlId: string): Promise<void> {
  await client.query("DELETE FROM crawl_diffs WHERE crawl_id = $1", [crawlId]);
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
  const snapshotNumber = await nextSnapshotNumber(client, crawlId);
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO crawl_snapshots (crawl_id, snapshot_number, summary)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [crawlId, snapshotNumber, JSON.stringify(summary)]
  );

  return result.rows[0].id;
}

async function nextSnapshotNumber(client: PoolClient, crawlId: string): Promise<number> {
  const result = await client.query<{ next_snapshot_number: number }>(
    `
      SELECT COALESCE(MAX(snapshot_number), 0) + 1 AS next_snapshot_number
      FROM crawl_snapshots
      WHERE crawl_id = $1
    `,
    [crawlId]
  );
  return Number(result.rows[0]?.next_snapshot_number ?? 1);
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

async function persistCrawlDiff(client: PoolClient, crawlId: string): Promise<void> {
  const baselineCrawlId = await findBaselineCrawlId(client, crawlId);
  const currentPages = await getDiffPages(client, crawlId);
  const baselinePages = baselineCrawlId ? await getDiffPages(client, baselineCrawlId) : [];
  const diff = buildCrawlDiff(currentPages, baselinePages, baselineCrawlId);

  await client.query(
    `
      INSERT INTO crawl_diffs (
        crawl_id,
        baseline_crawl_id,
        summary,
        new_pages,
        updated_pages,
        removed_pages,
        unchanged_pages
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (crawl_id) DO UPDATE SET
        baseline_crawl_id = EXCLUDED.baseline_crawl_id,
        summary = EXCLUDED.summary,
        new_pages = EXCLUDED.new_pages,
        updated_pages = EXCLUDED.updated_pages,
        removed_pages = EXCLUDED.removed_pages,
        unchanged_pages = EXCLUDED.unchanged_pages,
        created_at = now()
    `,
    [
      crawlId,
      diff.baselineCrawlId,
      JSON.stringify(diff.summary),
      JSON.stringify(diff.newPages),
      JSON.stringify(diff.updatedPages),
      JSON.stringify(diff.removedPages),
      JSON.stringify(diff.unchangedPages)
    ]
  );
}

async function findBaselineCrawlId(client: PoolClient, crawlId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `
      SELECT previous.id
      FROM crawls current
      JOIN crawls previous
        ON previous.url = current.url
       AND previous.id <> current.id
       AND previous.status = 'completed'
      WHERE current.id = $1
      ORDER BY previous.completed_at DESC NULLS LAST, previous.created_at DESC
      LIMIT 1
    `,
    [crawlId]
  );

  return result.rows[0]?.id ?? null;
}

async function getDiffPages(client: PoolClient, crawlId: string): Promise<CrawlDiffPage[]> {
  const result = await client.query<{
    url: string;
    title: string | null;
    content_hash: string | null;
    metadata_hash: string | null;
    word_count: number;
  }>(
    `
      SELECT url, title, content_hash, metadata_hash, word_count
      FROM pages
      WHERE crawl_id = $1
      ORDER BY url
    `,
    [crawlId]
  );

  return result.rows.map((row) => ({
    url: row.url,
    title: row.title,
    contentHash: row.content_hash,
    metadataHash: row.metadata_hash,
    wordCount: row.word_count
  }));
}

export function buildCrawlDiff(
  currentPages: CrawlDiffPage[],
  baselinePages: CrawlDiffPage[],
  baselineCrawlId: string | null
): CrawlDiff {
  const currentByUrl = new Map(currentPages.map((page) => [page.url, page]));
  const baselineByUrl = new Map(baselinePages.map((page) => [page.url, page]));
  const newPages: CrawlDiffPage[] = [];
  const updatedPages: CrawlDiffPage[] = [];
  const removedPages: CrawlDiffPage[] = [];
  const unchangedPages: CrawlDiffPage[] = [];

  for (const page of currentPages) {
    const baseline = baselineByUrl.get(page.url);
    if (!baseline) {
      newPages.push(page);
      continue;
    }

    if (page.contentHash !== baseline.contentHash || page.metadataHash !== baseline.metadataHash) {
      updatedPages.push(page);
    } else {
      unchangedPages.push(page);
    }
  }

  for (const page of baselinePages) {
    if (!currentByUrl.has(page.url)) {
      removedPages.push(page);
    }
  }

  return {
    baselineCrawlId,
    summary: {
      newPages: newPages.length,
      updatedPages: updatedPages.length,
      removedPages: removedPages.length,
      unchangedPages: unchangedPages.length
    },
    newPages,
    updatedPages,
    removedPages,
    unchangedPages
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
