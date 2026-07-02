import { z } from "zod";

const numberOrUnlimited = z.union([z.coerce.number().int().positive(), z.literal("unlimited")]);

export const createCrawlSchema = z.object({
  url: z.string().url(),
  depth: numberOrUnlimited.default(2),
  maxPages: numberOrUnlimited.default(50),
  downloadImages: z.boolean().default(true),
  downloadVideos: z.boolean().default(false),
  downloadDocuments: z.boolean().default(false),
  exportType: z.enum(["markdown", "json", "jsonl", "both"]).default("both"),
  domainMode: z.enum(["internal", "internal_external"]).default("internal"),
  chunkSize: z.coerce.number().int().min(200).max(2000).default(800),
  chunkOverlap: z.coerce.number().int().min(0).max(500).default(100)
});

export type CreateCrawlInput = z.infer<typeof createCrawlSchema>;
