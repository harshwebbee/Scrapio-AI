import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { discoverLinks, extractPage, slugForPage } from "./extract.js";
import { assetFolder, chunkContent, isInternalUrl, normalizeUrl } from "./utils.js";
export async function runCrawl(config, onProgress) {
    const rootUrl = normalizeUrl(config.url);
    if (!rootUrl)
        throw new Error("Invalid URL");
    await prepareOutput(config.outputDir);
    const visited = new Set();
    const queued = new Set([rootUrl]);
    const queue = [{ url: rootUrl, depth: 0 }];
    const pages = [];
    let assetsDownloaded = 0;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const emit = async (partial) => {
        const summary = summarize(pages, assetsDownloaded, queue.length, partial);
        await onProgress?.(summary);
    };
    await emit({ status: "running", message: "Crawl started" });
    try {
        while (queue.length > 0 && withinMaxPages(pages.length, config.maxPages)) {
            const item = queue.shift();
            if (visited.has(item.url))
                continue;
            visited.add(item.url);
            await emit({ currentUrl: item.url, status: "running" });
            const response = await page.goto(item.url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
            if (!response)
                continue;
            const html = await page.content();
            const extracted = extractPage(html, item.url, rootUrl);
            pages.push(extracted);
            await downloadSelectedAssets(extracted, config).then((count) => {
                assetsDownloaded += count;
            });
            if (withinDepth(item.depth, config.depth)) {
                for (const link of discoverLinks(html, item.url, rootUrl)) {
                    if (!visited.has(link) && !queued.has(link) && isInternalUrl(link, rootUrl)) {
                        queued.add(link);
                        queue.push({ url: link, depth: item.depth + 1 });
                    }
                }
            }
        }
    }
    finally {
        await context.close();
        await browser.close();
    }
    const chunks = buildChunks(pages);
    await writeExports(rootUrl, pages, chunks, config);
    const result = {
        website: rootUrl,
        crawl_date: new Date().toISOString(),
        pages,
        chunks,
        summary: summarize(pages, assetsDownloaded, 0, { status: "completed", message: "Crawl completed" }),
        outputDir: config.outputDir
    };
    await fs.writeFile(path.join(config.outputDir, "metadata.json"), JSON.stringify(result.summary, null, 2));
    await emit({ status: "completed", message: "Crawl completed", remainingQueue: 0 });
    return result;
}
async function prepareOutput(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
        fs.mkdir(path.join(outputDir, "markdown"), { recursive: true }),
        fs.mkdir(path.join(outputDir, "json"), { recursive: true }),
        fs.mkdir(path.join(outputDir, "images"), { recursive: true }),
        fs.mkdir(path.join(outputDir, "videos"), { recursive: true }),
        fs.mkdir(path.join(outputDir, "documents"), { recursive: true }),
        fs.mkdir(path.join(outputDir, "metadata"), { recursive: true })
    ]);
}
async function downloadSelectedAssets(page, config) {
    const selected = [
        ...(config.downloadImages ? page.images : []),
        ...(config.downloadVideos ? page.videos : []),
        ...(config.downloadDocuments ? page.documents : [])
    ];
    let count = 0;
    for (const asset of selected) {
        const folder = assetFolder(asset.type);
        const localPath = path.join(config.outputDir, folder, asset.filename);
        try {
            const response = await fetch(asset.url);
            if (!response.ok || !response.body)
                continue;
            const data = Buffer.from(await response.arrayBuffer());
            await fs.writeFile(localPath, data);
            asset.localPath = path.relative(config.outputDir, localPath);
            count += 1;
        }
        catch {
            continue;
        }
    }
    return count;
}
async function writeExports(rootUrl, pages, chunks, config) {
    const crawlDate = new Date().toISOString();
    if (config.exportType === "markdown" || config.exportType === "both") {
        await Promise.all(pages.map((page) => {
            const markdown = `---\nurl: ${page.url}\ntitle: ${JSON.stringify(page.title)}\n---\n\n${page.markdown}\n`;
            return fs.writeFile(path.join(config.outputDir, "markdown", `${slugForPage(page.url)}.md`), markdown);
        }));
    }
    if (config.exportType === "json" || config.exportType === "both") {
        const knowledgeBase = {
            website: rootUrl,
            crawl_date: crawlDate,
            pages,
            chunks
        };
        await fs.writeFile(path.join(config.outputDir, "json", "knowledge-base.json"), JSON.stringify(knowledgeBase, null, 2));
    }
    await fs.writeFile(path.join(config.outputDir, "metadata", "pages.json"), JSON.stringify(pages.map((page) => page.metadata), null, 2));
}
function buildChunks(pages) {
    const chunks = [];
    let nextIndex = 1;
    for (const page of pages) {
        const result = chunkContent(page.path, page.content, nextIndex);
        result.chunks.forEach((content, offset) => {
            chunks.push({
                chunk_id: String(nextIndex + offset).padStart(3, "0"),
                page: page.path,
                content,
                embedding_ready: true
            });
        });
        nextIndex = result.nextIndex;
    }
    return chunks;
}
function withinDepth(depth, maxDepth) {
    return maxDepth === "unlimited" || depth < maxDepth;
}
function withinMaxPages(currentCount, maxPages) {
    return maxPages === "unlimited" || currentCount < maxPages;
}
function summarize(pages, assetsDownloaded, remainingQueue, partial) {
    const imagesFound = pages.reduce((total, page) => total + page.images.length, 0);
    const videosFound = pages.reduce((total, page) => total + page.videos.length, 0);
    const documentsFound = pages.reduce((total, page) => total + page.documents.length, 0);
    const totalContentSize = pages.reduce((total, page) => total + Buffer.byteLength(page.content, "utf8"), 0);
    return {
        pagesProcessed: pages.length,
        remainingQueue,
        pagesCrawled: pages.length,
        assetsDownloaded,
        imagesFound,
        videosFound,
        documentsFound,
        totalContentSize,
        status: partial.status ?? "running",
        ...partial
    };
}
