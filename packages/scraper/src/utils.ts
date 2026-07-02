import path from "node:path";
import crypto from "node:crypto";

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif"]);
export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m3u8"]);
export const DOCUMENT_EXTENSIONS = new Set([".pdf", ".pptx", ".docx", ".xlsx", ".csv"]);

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isInternalUrl(candidate: string, root: string): boolean {
  return new URL(candidate).hostname === new URL(root).hostname;
}

export function pageSlug(pageUrl: string): string {
  const url = new URL(pageUrl);
  const cleanPath = url.pathname.replace(/^\/+|\/+$/g, "") || "home";
  const slug = cleanPath.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return slug || crypto.createHash("sha1").update(pageUrl).digest("hex").slice(0, 10);
}

export function safeFilename(assetUrl: string): string {
  const url = new URL(assetUrl);
  const base = decodePathSegment(path.basename(url.pathname)) || "asset";
  const ext = path.extname(base);
  const name = (ext ? base.slice(0, -ext.length) : base).replace(/[^a-z0-9._-]+/gi, "-") || "asset";
  const hash = crypto.createHash("sha1").update(assetUrl).digest("hex").slice(0, 8);
  return `${name}-${hash}${ext}`;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function classifyAsset(assetUrl: string): "image" | "video" | "document" | null {
  const ext = path.extname(new URL(assetUrl).pathname).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return null;
}

export function assetFolder(type: "image" | "video" | "document"): string {
  if (type === "image") return "images";
  if (type === "video") return "videos";
  return "documents";
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chunkContent(
  pagePath: string,
  content: string,
  startIndex: number,
  chunkSize = 800,
  overlap = 100
): { chunks: string[]; nextIndex: number } {
  const words = content.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let cursor = 0;

  while (cursor < words.length) {
    chunks.push(words.slice(cursor, cursor + chunkSize).join(" "));
    if (cursor + chunkSize >= words.length) break;
    cursor += step;
  }

  return {
    chunks,
    nextIndex: startIndex + chunks.length
  };
}
