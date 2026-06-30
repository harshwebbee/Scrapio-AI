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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!crawl?.id) return;
    const socket: Socket = io(apiUrl, { transports: ["websocket", "polling"] });
    socket.emit("watch:crawl", crawl.id);
    socket.on("crawl:progress", (event: CrawlEvent) => setCrawl(event));
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
    setError("");
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
        const body = await response.json();
        throw new Error(body.error ?? "Unable to start crawl");
      }

      const body = await response.json();
      setCrawl({ id: body.id, status: body.status, progress: {}, result: null, failedReason: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start crawl");
    } finally {
      setIsSubmitting(false);
    }
  }

  const ready = crawl?.status === "completed";

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

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Starting crawl" : "Start crawl"}
          </button>

          {error ? <p className="error">{error}</p> : null}
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

          {crawl?.failedReason ? <p className="error">{crawl.failedReason}</p> : null}

          <a className={`download ${ready ? "" : "disabled"}`} href={ready ? `${apiUrl}/api/crawls/${crawl.id}/download` : undefined}>
            Download ZIP
          </a>
        </section>
      </form>
    </main>
  );
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
