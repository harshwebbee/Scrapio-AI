"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

type Progress = {
  currentUrl?: string;
  pagesProcessed?: number;
  remainingQueue?: number;
  pagesCrawled?: number;
  assetsDownloaded?: number;
  imagesFound?: number;
  videosFound?: number;
  documentsFound?: number;
  totalContentSize?: number;
  status?: string;
  message?: string;
};

type CrawlEvent = {
  id: string;
  status: string;
  progress: Progress;
  result: {
    pagesCrawled: number;
    chunks: number;
  } | null;
  failedReason: string | null;
};

type CrawlDiff = {
  baselineCrawlId: string | null;
  summary: {
    newPages: number;
    updatedPages: number;
    removedPages: number;
    unchangedPages: number;
  };
};

type CrawlDetail = {
  id: string;
  url: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  chunkSize: number;
  chunkOverlap: number;
  summary: Progress & { chunks?: number };
  diff: CrawlDiff | null;
};

type CrawlPageSummary = {
  id: string;
  url: string;
  title: string | null;
  wordCount: number;
  statusCode: number | null;
  links: number;
  assets: number;
  chunks: number;
};

type CrawlAnalytics = {
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
};

type DuplicateReport = {
  duplicateTitles: Array<{
    title: string;
    count: number;
    pages: Array<{ pageId: string; url: string }>;
  }>;
  duplicatePages: Array<{
    contentHash: string;
    count: number;
    pages: Array<{ pageId: string; url: string; title: string | null }>;
  }>;
  duplicateChunks: Array<{
    fingerprint: string;
    count: number;
    pages: Array<{ pageId: string; url: string; chunkId: string }>;
  }>;
};

type CrawlTree = {
  rootUrl: string;
  nodes: Array<{
    id: string;
    url: string;
    title: string | null;
    path: string;
    depth: number | null;
    wordCount: number;
    links: number;
    assets: number;
    chunks: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    text: string | null;
  }>;
};

type CrawlSearchResult = {
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  chunkId: string | null;
  snippet: string;
  matchType: "page" | "chunk";
};

type ServiceHealth = {
  name: string;
  ok: boolean;
  message: string;
  action?: string;
};

type SystemHealth = {
  ok: boolean;
  checks: ServiceHealth[];
};

type AppError = {
  code: string;
  message: string;
  action?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const [url, setUrl] = useState("https://example.com");
  const [depth, setDepth] = useState("2");
  const [maxPages, setMaxPages] = useState("50");
  const [downloadImages, setDownloadImages] = useState(true);
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [downloadDocuments, setDownloadDocuments] = useState(false);
  const [exportType, setExportType] = useState<"markdown" | "json" | "jsonl" | "both">("both");
  const [domainMode, setDomainMode] = useState<"internal" | "internal_external">("internal");
  const [chunkSize, setChunkSize] = useState("800");
  const [chunkOverlap, setChunkOverlap] = useState("100");
  const [crawl, setCrawl] = useState<CrawlEvent | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [crawlDetail, setCrawlDetail] = useState<CrawlDetail | null>(null);
  const [crawlPages, setCrawlPages] = useState<CrawlPageSummary[]>([]);
  const [analytics, setAnalytics] = useState<CrawlAnalytics | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const [crawlTree, setCrawlTree] = useState<CrawlTree | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CrawlSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch(`${apiUrl}/api/system/health`);
        const body = await response.json();
        if (!cancelled) {
          setHealth(body);
          setHealthError(null);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setHealthError({
            code: "API_UNAVAILABLE",
            message: "The API is not reachable.",
            action: `Start the API server and confirm NEXT_PUBLIC_API_URL points to ${apiUrl}.`
          });
        }
      }
    }

    loadHealth();
    const timer = window.setInterval(loadHealth, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!crawl?.id) return;
    const socket: Socket = io(apiUrl, { transports: ["websocket", "polling"] });
    socket.emit("watch:crawl", crawl.id);
    socket.on("crawl:progress", (event: CrawlEvent) => setCrawl(event));
    socket.on("crawl:error", (event: AppError) => setError(event));
    socket.on("connect_error", () =>
      setError({
        code: "LIVE_PROGRESS_UNAVAILABLE",
        message: "Live progress is not connected.",
        action: "Confirm the API server is running, then refresh the page."
      })
    );
    return () => {
      socket.disconnect();
    };
  }, [crawl?.id]);

  useEffect(() => {
    if (!crawl?.id || crawl.status !== "completed") return;
    let cancelled = false;

    async function loadCrawlDetail() {
      try {
        const [detailResponse, pagesResponse, analyticsResponse] = await Promise.all([
          fetch(`${apiUrl}/api/crawls/${crawl?.id}/detail`),
          fetch(`${apiUrl}/api/crawls/${crawl?.id}/pages`),
          fetch(`${apiUrl}/api/crawls/${crawl?.id}/analytics`)
        ]);
        const [duplicatesResponse, treeResponse] = await Promise.all([
          fetch(`${apiUrl}/api/crawls/${crawl?.id}/duplicates`),
          fetch(`${apiUrl}/api/crawls/${crawl?.id}/tree`)
        ]);

        if (!detailResponse.ok) throw await readApiError(detailResponse);
        if (!pagesResponse.ok) throw await readApiError(pagesResponse);
        if (!analyticsResponse.ok) throw await readApiError(analyticsResponse);
        if (!duplicatesResponse.ok) throw await readApiError(duplicatesResponse);
        if (!treeResponse.ok) throw await readApiError(treeResponse);

        const detail = await detailResponse.json();
        const pageBody = await pagesResponse.json();
        const crawlAnalytics = await analyticsResponse.json();
        const duplicateReport = await duplicatesResponse.json();
        const tree = await treeResponse.json();
        if (!cancelled) {
          setCrawlDetail(detail);
          setCrawlPages(Array.isArray(pageBody.pages) ? pageBody.pages : []);
          setAnalytics(crawlAnalytics);
          setDuplicates(duplicateReport);
          setCrawlTree(tree);
        }
      } catch (err) {
        if (!cancelled) setError(normalizeClientError(err));
      }
    }

    loadCrawlDetail();
    return () => {
      cancelled = true;
    };
  }, [crawl?.id, crawl?.status]);

  const completion = useMemo(() => {
    const processed = crawl?.progress.pagesProcessed ?? 0;
    const remaining = crawl?.progress.remainingQueue ?? 0;
    const total = processed + remaining;
    return total === 0 ? 0 : Math.round((processed / total) * 100);
  }, [crawl]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiUrl}/api/crawls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          depth: depth === "unlimited" ? "unlimited" : Number(depth),
          maxPages: maxPages === "unlimited" ? "unlimited" : Number(maxPages),
          downloadImages,
          downloadVideos,
          downloadDocuments,
          exportType,
          domainMode,
          chunkSize: Number(chunkSize),
          chunkOverlap: Number(chunkOverlap)
        })
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      const body = await response.json();
      setCrawl({ id: body.id, status: body.status, progress: {}, result: null, failedReason: null });
      setCrawlDetail(null);
      setCrawlPages([]);
      setAnalytics(null);
      setDuplicates(null);
      setCrawlTree(null);
      setSearchQuery("");
      setSearchResults([]);
    } catch (err) {
      setError(normalizeClientError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runSearch() {
    if (!crawl?.id || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/crawls/${crawl.id}/search?q=${encodeURIComponent(searchQuery)}`);
      if (!response.ok) throw await readApiError(response);
      const body = await response.json();
      setSearchResults(Array.isArray(body.results) ? body.results : []);
    } catch (err) {
      setError(normalizeClientError(err));
    } finally {
      setIsSearching(false);
    }
  }

  const ready = crawl?.status === "completed";
  const redisReady = health?.checks.find((check) => check.name === "redis")?.ok ?? false;
  const servicesReady = health?.ok ?? false;
  const apiReady = !healthError;
  const canSubmit = apiReady && servicesReady && !isSubmitting;

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Scrapio AI</p>
          <h1>Website export console</h1>
        </div>
        <div className={`status-pill ${crawl?.status ?? "idle"}`}>{crawl?.status ?? "idle"}</div>
      </section>

      <form className="crawler-grid" onSubmit={submit}>
        <section className="panel form-panel">
          <div className="health-strip">
            <div>
              <p className="eyebrow">System health</p>
              <strong>{health?.ok ? "All services ready" : "Action needed"}</strong>
            </div>
            <button className="text-button" type="button" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>

          {healthError ? <ErrorNotice error={healthError} /> : null}
          {health ? (
            <div className="service-grid">
              {health.checks.map((check) => (
                <div className={`service ${check.ok ? "ok" : "bad"}`} key={check.name}>
                  <span>{check.name}</span>
                  <strong>{check.ok ? "Ready" : "Missing"}</strong>
                  <small>{check.message}</small>
                  {check.action ? <small>{check.action}</small> : null}
                </div>
              ))}
            </div>
          ) : null}

          <label className="field wide">
            Website URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" required />
          </label>

          <label className="field">
            Crawl depth
            <select value={depth} onChange={(event) => setDepth(event.target.value)}>
              {["1", "2", "3", "5", "unlimited"].map((option) => (
                <option key={option} value={option}>
                  {option === "unlimited" ? "Unlimited" : option}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Max pages
            <select value={maxPages} onChange={(event) => setMaxPages(event.target.value)}>
              {["50", "100", "500", "1000", "unlimited"].map((option) => (
                <option key={option} value={option}>
                  {option === "unlimited" ? "Unlimited" : option}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field-group">
            <legend>Assets</legend>
            <Switch label="Images" checked={downloadImages} onChange={setDownloadImages} />
            <Switch label="Videos" checked={downloadVideos} onChange={setDownloadVideos} />
            <Switch label="Documents" checked={downloadDocuments} onChange={setDownloadDocuments} />
          </fieldset>

          <fieldset className="field-group">
            <legend>Export</legend>
            <Segment label="Markdown" active={exportType === "markdown"} onClick={() => setExportType("markdown")} />
            <Segment label="JSON" active={exportType === "json"} onClick={() => setExportType("json")} />
            <Segment label="JSONL" active={exportType === "jsonl"} onClick={() => setExportType("jsonl")} />
            <Segment label="Both" active={exportType === "both"} onClick={() => setExportType("both")} />
          </fieldset>

          <fieldset className="field-group">
            <legend>Chunks</legend>
            <label className="mini-field">
              Size
              <input
                type="number"
                min="200"
                max="2000"
                step="50"
                value={chunkSize}
                onChange={(event) => setChunkSize(event.target.value)}
              />
            </label>
            <label className="mini-field">
              Overlap
              <input
                type="number"
                min="0"
                max="500"
                step="25"
                value={chunkOverlap}
                onChange={(event) => setChunkOverlap(event.target.value)}
              />
            </label>
          </fieldset>

          <fieldset className="field-group">
            <legend>Links</legend>
            <Segment label="Internal" active={domainMode === "internal"} onClick={() => setDomainMode("internal")} />
            <Segment
              label="Internal + external"
              active={domainMode === "internal_external"}
              onClick={() => setDomainMode("internal_external")}
            />
          </fieldset>

          <button className="primary-button" disabled={!canSubmit} type="submit">
            {isSubmitting ? "Starting crawl" : redisReady && servicesReady ? "Start crawl" : "Start services first"}
          </button>

          {error ? <ErrorNotice error={error} /> : null}
        </section>

        <section className="panel progress-panel">
          <div className="progress-head">
            <div>
              <p className="eyebrow">Live progress</p>
              <h2>{crawl?.progress.message ?? "Ready for a crawl"}</h2>
            </div>
            <span>{completion}%</span>
          </div>

          <div className="meter" aria-label="Crawl completion">
            <div style={{ width: `${completion}%` }} />
          </div>

          <div className="current-url">{crawl?.progress.currentUrl ?? "No active URL"}</div>

          <div className="stats">
            <Stat label="Pages crawled" value={crawl?.progress.pagesCrawled ?? 0} />
            <Stat label="Queue" value={crawl?.progress.remainingQueue ?? 0} />
            <Stat label="Images" value={crawl?.progress.imagesFound ?? 0} />
            <Stat label="Videos" value={crawl?.progress.videosFound ?? 0} />
            <Stat label="Documents" value={crawl?.progress.documentsFound ?? 0} />
            <Stat label="Assets saved" value={crawl?.progress.assetsDownloaded ?? 0} />
            <Stat label="Content size" value={`${Math.round((crawl?.progress.totalContentSize ?? 0) / 1024)} KB`} />
            <Stat label="AI chunks" value={crawl?.result?.chunks ?? 0} />
          </div>

          {crawl?.failedReason ? <ErrorNotice error={friendlyFailedReason(crawl.failedReason)} /> : null}

          <a className={`download ${ready ? "" : "disabled"}`} href={ready ? `${apiUrl}/api/crawls/${crawl.id}/download` : undefined}>
            Download ZIP
          </a>

          {crawlDetail ? (
            <section className="intelligence">
              <div>
                <p className="eyebrow">Crawl intelligence</p>
                <h2>{crawlDetail.diff?.baselineCrawlId ? "Compared with previous crawl" : "First crawl snapshot"}</h2>
              </div>

              <div className="stats diff-stats">
                <Stat label="New pages" value={crawlDetail.diff?.summary.newPages ?? crawlPages.length} />
                <Stat label="Updated" value={crawlDetail.diff?.summary.updatedPages ?? 0} />
                <Stat label="Removed" value={crawlDetail.diff?.summary.removedPages ?? 0} />
                <Stat label="Unchanged" value={crawlDetail.diff?.summary.unchangedPages ?? 0} />
              </div>

              {analytics ? (
                <div className="stats analytics-stats">
                  <Stat label="Words" value={analytics.totals.words} />
                  <Stat label="Links" value={analytics.totals.links} />
                  <Stat label="External links" value={analytics.links.external} />
                  <Stat label="Asset bytes" value={`${Math.round(analytics.assets.bytes / 1024)} KB`} />
                </div>
              ) : null}

              {duplicates ? (
                <div className="insight-grid">
                  <InsightCard
                    label="Duplicate titles"
                    value={duplicates.duplicateTitles.length}
                    detail={duplicates.duplicateTitles[0]?.title ?? "No repeated titles found"}
                  />
                  <InsightCard
                    label="Duplicate pages"
                    value={duplicates.duplicatePages.length}
                    detail={duplicates.duplicatePages[0]?.pages.map((page) => page.url).join(", ") ?? "No identical pages found"}
                  />
                  <InsightCard
                    label="Duplicate chunks"
                    value={duplicates.duplicateChunks.length}
                    detail={duplicates.duplicateChunks[0]?.pages.map((page) => page.url).join(", ") ?? "No repeated chunks found"}
                  />
                  <InsightCard
                    label="Tree edges"
                    value={crawlTree?.edges.length ?? 0}
                    detail={crawlTree ? `${crawlTree.nodes.length} pages mapped from ${crawlTree.rootUrl}` : "Tree unavailable"}
                  />
                </div>
              ) : null}

              <div className="search-box">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runSearch();
                    }
                  }}
                  placeholder="Search crawled content"
                />
                <button type="button" onClick={runSearch} disabled={isSearching}>
                  {isSearching ? "Searching" : "Search"}
                </button>
              </div>

              {searchResults.length > 0 ? (
                <div className="search-results">
                  {searchResults.map((result) => (
                    <div className="search-result" key={`${result.pageId}-${result.chunkId ?? "page"}`}>
                      <strong>{result.pageTitle || result.pageUrl}</strong>
                      <span>{result.snippet}</span>
                      <small>{result.matchType === "chunk" ? `Chunk ${result.chunkId}` : "Page match"}</small>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="page-table">
                {crawlPages.slice(0, 6).map((page) => (
                  <div className="page-row" key={page.id}>
                    <div>
                      <strong>{page.title || page.url}</strong>
                      <span>{page.url}</span>
                    </div>
                    <small>{page.wordCount} words</small>
                    <small>{page.links} links</small>
                    <small>{page.chunks} chunks</small>
                  </div>
                ))}
              </div>

              {crawlTree ? (
                <div className="tree-list">
                  {crawlTree.nodes
                    .slice()
                    .sort((a, b) => (a.depth ?? 999) - (b.depth ?? 999) || a.path.localeCompare(b.path))
                    .slice(0, 10)
                    .map((node) => (
                      <div className="tree-row" key={node.id}>
                        <span style={{ paddingLeft: `${Math.min(node.depth ?? 0, 5) * 14}px` }}>
                          {node.depth === null ? "Orphan" : `Level ${node.depth}`}
                        </span>
                        <strong>{node.title || node.path}</strong>
                        <small>
                          {node.links} links · {node.assets} assets · {node.chunks} chunks
                        </small>
                      </div>
                    ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      </form>
    </main>
  );
}

async function readApiError(response: Response): Promise<AppError> {
  const fallback: AppError = {
    code: "REQUEST_FAILED",
    message: "The request could not be completed.",
    action: "Check the service status and try again."
  };

  const body = await response.json().catch(() => null);
  if (body?.error && typeof body.error === "object") {
    return {
      code: String(body.error.code ?? fallback.code),
      message: String(body.error.message ?? fallback.message),
      action: body.error.action ? String(body.error.action) : fallback.action
    };
  }

  if (typeof body?.error === "string") {
    return {
      ...fallback,
      message: body.error
    };
  }

  return fallback;
}

function normalizeClientError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return {
    code: "REQUEST_FAILED",
    message: "Scrapio could not start the crawl.",
    action: "Check that the API and Redis are running, then try again."
  };
}

function friendlyFailedReason(reason: string): AppError {
  if (/chromium|playwright|executable/i.test(reason)) {
    return {
      code: "PLAYWRIGHT_BROWSER_MISSING",
      message: "The crawler browser is not installed.",
      action: "Run `npx playwright install chromium`, then retry the crawl."
    };
  }

  if (/ECONNREFUSED|Redis|6379/i.test(reason)) {
    return {
      code: "REDIS_UNAVAILABLE",
      message: "The crawl worker lost its Redis connection.",
      action: "Run `npm run infra:up`, restart the worker, then retry."
    };
  }

  return {
    code: "CRAWL_FAILED",
    message: "The crawl failed before the export was created.",
    action: "Review the worker logs, then retry with a smaller page limit."
  };
}

function isAppError(error: unknown): error is AppError {
  return Boolean(error && typeof error === "object" && "message" in error && "code" in error);
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
      {label}
    </label>
  );
}

function Segment({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`segment ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="insight-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ErrorNotice({ error }: { error: AppError }) {
  return (
    <div className="notice" role="alert">
      <strong>{error.message}</strong>
      {error.action ? <span>{error.action}</span> : null}
    </div>
  );
}
