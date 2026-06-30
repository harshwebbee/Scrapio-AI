import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { classifyAsset, htmlToPlainText, isInternalUrl, normalizeUrl, pageSlug, safeFilename } from "./utils.js";
const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-"
});
const removableSelectors = [
    "nav",
    "header",
    "footer",
    "aside",
    "script",
    "style",
    "noscript",
    "iframe",
    "[aria-hidden='true']",
    "[hidden]",
    ".cookie",
    ".cookie-banner",
    ".popup",
    ".modal",
    ".advertisement",
    ".ads",
    "[class*='cookie']",
    "[class*='popup']",
    "[class*='banner']",
    "[id*='cookie']",
    "[id*='popup']"
];
export function extractPage(html, pageUrl, rootUrl) {
    const $ = cheerio.load(html);
    removableSelectors.forEach((selector) => $(selector).remove());
    const metadata = extractMetadata($);
    const headings = $("h1,h2,h3,h4,h5,h6")
        .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);
    const links = extractLinks($, pageUrl, rootUrl);
    const assets = extractAssets($, pageUrl);
    const readableHtml = getReadableHtml($.html(), pageUrl) ?? $("main").html() ?? $("article").html() ?? $("body").html() ?? "";
    const markdown = turndown.turndown(readableHtml).replace(/\n{3,}/g, "\n\n").trim();
    const content = htmlToPlainText(readableHtml);
    const title = metadata.title || $("h1").first().text().trim() || new URL(pageUrl).pathname || pageUrl;
    return {
        url: pageUrl,
        path: new URL(pageUrl).pathname || "/",
        title,
        content,
        markdown,
        headings,
        links,
        images: assets.filter((asset) => asset.type === "image"),
        videos: assets.filter((asset) => asset.type === "video"),
        documents: assets.filter((asset) => asset.type === "document"),
        metadata
    };
}
export function discoverLinks(html, pageUrl, rootUrl) {
    const $ = cheerio.load(html);
    const discovered = new Set();
    $("a[href]").each((_, el) => {
        const normalized = normalizeUrl($(el).attr("href") ?? "", pageUrl);
        if (normalized && isInternalUrl(normalized, rootUrl))
            discovered.add(normalized);
    });
    return [...discovered];
}
function extractMetadata($) {
    const content = (selector) => $(selector).attr("content")?.trim() ?? "";
    return {
        title: $("title").first().text().trim(),
        description: content("meta[name='description']"),
        keywords: content("meta[name='keywords']")
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        canonical_url: $("link[rel='canonical']").attr("href") ?? "",
        og_title: content("meta[property='og:title']"),
        og_description: content("meta[property='og:description']"),
        og_image: content("meta[property='og:image']"),
        language: $("html").attr("lang") ?? "",
        author: content("meta[name='author']")
    };
}
function extractLinks($, pageUrl, rootUrl) {
    const seen = new Set();
    const links = [];
    $("a[href]").each((_, el) => {
        const normalized = normalizeUrl($(el).attr("href") ?? "", pageUrl);
        if (!normalized || seen.has(normalized))
            return;
        seen.add(normalized);
        links.push({
            text: $(el).text().replace(/\s+/g, " ").trim() || normalized,
            url: normalized,
            type: isInternalUrl(normalized, rootUrl) ? "internal" : "external"
        });
    });
    return links;
}
function extractAssets($, pageUrl) {
    const urls = new Set();
    $("img[src], source[src], video[src], a[href]").each((_, el) => {
        const raw = $(el).attr("src") ?? $(el).attr("href") ?? "";
        const normalized = normalizeUrl(raw, pageUrl);
        if (normalized)
            urls.add(normalized);
    });
    $("img[srcset], source[srcset]").each((_, el) => {
        const srcset = $(el).attr("srcset") ?? "";
        srcset.split(",").forEach((part) => {
            const raw = part.trim().split(/\s+/)[0];
            const normalized = normalizeUrl(raw, pageUrl);
            if (normalized)
                urls.add(normalized);
        });
    });
    return [...urls].flatMap((url) => {
        const type = classifyAsset(url);
        return type ? [{ type, url, filename: safeFilename(url) }] : [];
    });
}
function getReadableHtml(html, pageUrl) {
    try {
        const dom = new JSDOM(html, { url: pageUrl });
        const article = new Readability(dom.window.document).parse();
        return article?.content ?? null;
    }
    catch {
        return null;
    }
}
export function slugForPage(pageUrl) {
    return pageSlug(pageUrl);
}
