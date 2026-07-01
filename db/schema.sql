CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  depth TEXT NOT NULL DEFAULT '2',
  max_pages TEXT NOT NULL DEFAULT '50',
  export_type TEXT NOT NULL DEFAULT 'both',
  domain_mode TEXT NOT NULL DEFAULT 'internal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_reason TEXT
);

CREATE TABLE IF NOT EXISTS crawl_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  snapshot_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (crawl_id, snapshot_number)
);

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES crawl_snapshots(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  content_hash TEXT,
  metadata_hash TEXT,
  markdown_path TEXT,
  json_path TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crawl_id, url)
);

CREATE TABLE IF NOT EXISTS page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES crawl_snapshots(id) ON DELETE CASCADE,
  content_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  headings JSONB NOT NULL DEFAULT '[]'::jsonb,
  markdown_path TEXT,
  json_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  url TEXT NOT NULL,
  local_path TEXT,
  content_hash TEXT,
  byte_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  source_page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  text TEXT,
  link_type TEXT NOT NULL,
  status_code INTEGER,
  redirect_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL,
  local_path TEXT,
  storage_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pages_crawl_id_idx ON pages(crawl_id);
CREATE INDEX IF NOT EXISTS assets_crawl_id_idx ON assets(crawl_id);
CREATE INDEX IF NOT EXISTS links_crawl_id_idx ON links(crawl_id);
CREATE INDEX IF NOT EXISTS chunks_page_id_idx ON chunks(page_id);
