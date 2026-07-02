import assert from "node:assert/strict";
import test from "node:test";
import { chunkContent, classifyAsset, normalizeUrl, safeFilename } from "./utils.js";

test("normalizeUrl resolves relative HTTP URLs and removes fragments/trailing slashes", () => {
  assert.equal(normalizeUrl("/docs/#intro", "https://example.com/root/"), "https://example.com/docs");
  assert.equal(normalizeUrl("mailto:hello@example.com", "https://example.com"), null);
});

test("classifyAsset detects supported asset types from URL paths", () => {
  assert.equal(classifyAsset("https://example.com/photo.webp?width=800"), "image");
  assert.equal(classifyAsset("https://example.com/clip.mp4"), "video");
  assert.equal(classifyAsset("https://example.com/report.pdf"), "document");
  assert.equal(classifyAsset("https://example.com/page"), null);
});

test("safeFilename keeps the extension and adds a stable disambiguating hash", () => {
  const filename = safeFilename("https://example.com/assets/My File.pdf?download=1");
  assert.match(filename, /^My-File-[a-f0-9]{8}\.pdf$/);
});

test("chunkContent creates overlapping chunks for long pages", () => {
  const content = Array.from({ length: 900 }, (_, index) => `word${index}`).join(" ");
  const result = chunkContent("/docs", content, 7);

  assert.equal(result.chunks.length, 2);
  assert.equal(result.nextIndex, 9);
  assert.match(result.chunks[0], /^word0 /);
  assert.match(result.chunks[1], /^word700 /);
});

test("chunkContent accepts custom chunk size and overlap", () => {
  const content = Array.from({ length: 12 }, (_, index) => `word${index}`).join(" ");
  const result = chunkContent("/docs", content, 1, 5, 2);

  assert.deepEqual(result.chunks, [
    "word0 word1 word2 word3 word4",
    "word3 word4 word5 word6 word7",
    "word6 word7 word8 word9 word10",
    "word9 word10 word11"
  ]);
});
