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
  const [exportType, setExportType] = useState<"markdown" | "json" | "both">("both");
  const [domainMode, setDomainMode] = useState<"internal" | "internal_external">("internal");
  const [crawl, setCrawl] = useState<CrawlEvent | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

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
          domainMode
        })
      });

      if (!response.ok) {
        throw await readApiError(response);
      }

      const body = await response.json();
      setCrawl({ id: body.id, status: body.status, progress: {}, result: null, failedReason: null });
    } catch (err) {
      setError(normalizeClientError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const ready = crawl?.status === "completed";
  const redisReady = health?.checks.find((check) => check.name === "redis")?.ok ?? false;
  const apiReady = !healthError;
  const canSubmit = apiReady && redisReady && !isSubmitting;

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
            <Segment label="Both" active={exportType === "both"} onClick={() => setExportType("both")} />
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
            {isSubmitting ? "Starting crawl" : redisReady ? "Start crawl" : "Start Redis first"}
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

function ErrorNotice({ error }: { error: AppError }) {
  return (
    <div className="notice" role="alert">
      <strong>{error.message}</strong>
      {error.action ? <span>{error.action}</span> : null}
    </div>
  );
}
