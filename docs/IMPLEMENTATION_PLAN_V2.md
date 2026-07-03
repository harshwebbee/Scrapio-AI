# Scrapio AI v2.0 Implementation Plan

## Current MVP Baseline

The current app provides:

- URL submission
- Playwright-based rendering
- Internal link discovery
- Content, metadata, link, and asset extraction
- Markdown export
- JSON knowledge-base export
- AI-ready chunks
- ZIP download
- BullMQ and Redis queue wiring
- Next.js dashboard

## Delivery Strategy

Build v2 in phases. Each phase should leave the product usable and shippable.

## Phase 1: Production Foundation

Goal: make the MVP durable, observable, and ready for real users.

Deliverables:

- PostgreSQL schema for crawls, pages, assets, chunks, and crawl snapshots
- S3 or R2 storage adapter for exports and assets
- Docker Compose for web, API, worker, Redis, and PostgreSQL
- GitHub Actions build pipeline
- API health checks for Redis, database, storage, and Playwright
- Better UI error states for missing API, missing Redis, and failed crawls
- Worker retry and timeout policies

Suggested tables:

```text
users
crawls
crawl_snapshots
pages
page_versions
assets
links
chunks
exports
jobs
```

## Phase 2: Crawl Intelligence

Goal: make crawling incremental, inspectable, and comparable.

Deliverables:

- Content hash for each crawled page
- Asset hash and metadata tracking
- Incremental crawl mode
- Crawl snapshot history
- Crawl diff engine
- New, deleted, and updated page reports
- Changed metadata and changed image reports
- Duplicate title and duplicate content detection
- Crawl tree API
- Crawl tree UI with expand, collapse, search, and node details

Implementation notes:

- Store normalized URL, canonical URL, content hash, metadata hash, and asset manifest hash.
- Use page content hash to skip unchanged pages.
- Use snapshot IDs to compare crawl versions.
- Use a simple text similarity baseline before adding embeddings.

## Phase 3: Search And Analytics

Goal: make extracted websites searchable and measurable.

Deliverables:

- Keyword search over page title, headings, content, and metadata
- Meilisearch or PostgreSQL full-text search integration
- Crawl dashboard with totals and duration
- Broken link checker
- Redirect tracking
- Word count, average page size, largest pages, and largest assets
- Internal linking analysis
- Orphan page detection
- Dead-end page detection
- Content distribution charts
- Website graph visualization with React Flow or D3

Implementation notes:

- Start with PostgreSQL full-text search for fewer moving parts.
- Add Meilisearch when search ranking and speed become product bottlenecks.
- Store HTTP status, redirect chain, content type, and response size per URL.

## Phase 4: Knowledge Base Builder

Goal: make exports useful for AI systems and data teams.

Deliverables:

- Configurable chunk size and overlap
- Markdown-preserving chunk mode
- JSONL export
- CSV export
- Vector dataset export
- Provider interface for embeddings
- OpenAI embedding provider
- Local/Ollama embedding provider
- PGVector support
- ChromaDB and Qdrant export adapters

Implementation notes:

- Keep provider keys out of crawl jobs and read them from encrypted user settings or server env.
- Track embedding model, dimensions, provider, and generated timestamp.
- Make chunk IDs stable across unchanged page versions where possible.

## Phase 5: AI Content Intelligence

Goal: turn raw extracted content into structured intelligence.

Deliverables:

- AI website summary
- AI business profile
- AI page classification
- AI content tags
- AI-generated FAQ
- AI documentation generator
- AI content quality analysis
- Executive summary agent

Implementation notes:

- Run AI workflows as separate jobs after crawl completion.
- Store prompt version, model, input page IDs, output JSON, and citations.
- Use strict JSON schemas for AI outputs.
- Require source references for generated summaries and FAQs.

## Phase 6: AI Search And Chat

Goal: allow users to ask questions against a crawled website.

Deliverables:

- Semantic search endpoint
- Chat with website endpoint
- Source citations
- Page references
- Confidence score
- Chat UI in dashboard
- Conversation history

Implementation notes:

- Retrieve chunks by vector similarity plus keyword fallback.
- Restrict answers to retrieved website knowledge.
- Return citation metadata with page URL, title, and chunk ID.

## Phase 7: SEO, Accessibility, And Performance

Goal: provide actionable site quality audits.

Deliverables:

- SEO score
- Title and meta description audit
- Canonical audit
- Open Graph and Twitter Card audit
- Robots meta audit
- Structured data detection
- Heading hierarchy audit
- Sitemap generator
- Robots.txt analyzer
- Accessibility score
- Missing alt text audit
- ARIA and form accessibility checks
- Asset size and performance report
- Image optimization suggestions

Implementation notes:

- Keep deterministic checks separate from AI-generated recommendations.
- Use Playwright and browser APIs for rendered DOM checks.
- Add axe-core later for deeper accessibility coverage.

## Phase 8: Monitoring And Automation

Goal: make Scrapio a continuous website monitoring platform.

Deliverables:

- Scheduled crawls
- Hourly, daily, weekly, monthly, and custom cron schedules
- Change notifications
- Weekly and monthly scheduled reports
- AI automation agents
- Email notifications
- Slack and webhook integrations

Implementation notes:

- Use BullMQ repeatable jobs or a dedicated scheduler service.
- Store notification preferences per project.
- Keep notification payloads small and link to full reports in the app.

## Phase 9: Enterprise And Developer Platform

Goal: prepare the platform for teams and external integrations.

Deliverables:

- Authentication
- RBAC
- API keys
- User quotas
- Domain allowlists
- Audit logs
- Robots.txt compliance mode
- Crawl rate limiting
- Developer API documentation
- Notion, Confluence, GitHub Wiki, Drive, Slack, Teams, Dropbox, and OneDrive integrations

Implementation notes:

- Add tenant/project boundaries before enterprise features.
- Apply quotas at crawl creation and worker execution time.
- Log user, action, target resource, and request metadata for auditability.

## Recommended Near-Term Backlog

1. Add Docker Compose for Redis and PostgreSQL.
2. Add database schema and persistence for crawls, pages, assets, links, and chunks.
3. Add API/UI health checks so users know when Redis, worker, or Playwright are missing.
4. Add crawl snapshots and content hashing.
5. Add crawl diff report.
6. Add duplicate content reports.
7. Add crawl tree API and dashboard view.
8. Add keyword search.
9. Add JSONL export.
10. Add OpenAI embedding provider.
11. Add semantic search.
12. Add website summary AI job.

## Definition Of Done For v2 Features

Each feature should include:

- API route or worker job
- Database persistence where needed
- UI state for loading, success, failure, and empty states
- Tests for core logic
- Documentation in README or docs
- Build validation with `npm run build`
