# Scrapio AI

Scrapio AI is an MVP web application for crawling a website, extracting AI-ready content and assets, and exporting Markdown, JSON knowledge-base data, or both as a ZIP archive.

## What Is Included

- Next.js crawl console with URL, depth, max pages, asset, export, and link-scope controls.
- Express API for crawl job creation, status lookup, WebSocket progress, and ZIP download.
- BullMQ + Redis background worker for long-running crawl jobs.
- Playwright page rendering for static and JavaScript-rendered websites.
- Cheerio, Mozilla Readability, and Turndown extraction pipeline.
- Internal page discovery from rendered anchor tags.
- Metadata, heading, hyperlink, image, video, and document extraction.
- Markdown export, JSON knowledge-base export, metadata export, and AI-ready chunks.

## Prerequisites

- Node.js 20+
- Redis running locally or available via `REDIS_URL`
- PostgreSQL running locally or available via `DATABASE_URL`
- Playwright browsers installed with `npx playwright install chromium`

## Setup

```bash
npm install
cp .env.example .env
```

Update `.env` if Redis or ports differ from the defaults.

## Local Infrastructure

The recommended local setup uses Docker for Redis and PostgreSQL:

```bash
npm run infra:up
```

Stop local infrastructure:

```bash
npm run infra:down
```

The PostgreSQL container initializes with [db/schema.sql](db/schema.sql).

## Run Locally

Start Redis/PostgreSQL first, then run these in separate terminals:

```bash
npm run infra:up
npm run dev:api
npm run worker
npm run dev:web
```

Open `http://localhost:3000`.

## Environment

```env
API_PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4000
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=postgres://scrapio:scrapio@127.0.0.1:5432/scrapio
STORAGE_DIR=./storage
```

The dashboard calls `/api/system/health` and shows whether API dependencies are ready before a crawl starts.

## API

Create a crawl:

```bash
curl -X POST http://localhost:4000/api/crawls \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "depth": 2,
    "maxPages": 50,
    "downloadImages": true,
    "downloadVideos": false,
    "downloadDocuments": false,
    "exportType": "both",
    "domainMode": "internal"
  }'
```

Check status:

```bash
curl http://localhost:4000/api/crawls/JOB_ID
```

Download export:

```bash
curl -L http://localhost:4000/api/crawls/JOB_ID/download -o scrapio-export.zip
```

## Output Shape

Each crawl writes to `storage/JOB_ID`:

```text
website-export/
  markdown/
  json/
  images/
  videos/
  documents/
  metadata/
  metadata.json
```

The JSON export includes:

- `website`
- `crawl_date`
- `pages`
- `chunks`

AI chunks target roughly 800 words with 100-word overlap.

## MVP Notes

Phase 1 has no authentication. PostgreSQL table definitions from the SRD are not yet wired because the MVP job state is held in BullMQ/Redis and export artifacts are stored on disk. The next durable step is adding PostgreSQL records for crawls, pages, and assets.

## Roadmap

- [Scrapio AI Roadmap v2.0](docs/ROADMAP_V2.md)
- [Scrapio AI v2.0 Implementation Plan](docs/IMPLEMENTATION_PLAN_V2.md)
