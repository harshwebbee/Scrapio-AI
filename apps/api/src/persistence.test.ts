import assert from "node:assert/strict";
import test from "node:test";
import { buildCrawlDiff, type CrawlDiffPage } from "./persistence.js";

const baselinePages: CrawlDiffPage[] = [
  {
    url: "https://example.com/",
    title: "Home",
    contentHash: "aaa",
    metadataHash: "meta-a",
    wordCount: 100
  },
  {
    url: "https://example.com/docs",
    title: "Docs",
    contentHash: "bbb",
    metadataHash: "meta-b",
    wordCount: 200
  },
  {
    url: "https://example.com/pricing",
    title: "Pricing",
    contentHash: "ccc",
    metadataHash: "meta-c",
    wordCount: 50
  }
];

test("buildCrawlDiff categorizes new, updated, removed, and unchanged pages", () => {
  const currentPages: CrawlDiffPage[] = [
    baselinePages[0],
    {
      ...baselinePages[1],
      contentHash: "changed"
    },
    {
      url: "https://example.com/blog",
      title: "Blog",
      contentHash: "ddd",
      metadataHash: "meta-d",
      wordCount: 125
    }
  ];

  const diff = buildCrawlDiff(currentPages, baselinePages, "baseline-id");

  assert.deepEqual(diff.summary, {
    newPages: 1,
    updatedPages: 1,
    removedPages: 1,
    unchangedPages: 1
  });
  assert.equal(diff.newPages[0].url, "https://example.com/blog");
  assert.equal(diff.updatedPages[0].url, "https://example.com/docs");
  assert.equal(diff.removedPages[0].url, "https://example.com/pricing");
  assert.equal(diff.unchangedPages[0].url, "https://example.com/");
});
