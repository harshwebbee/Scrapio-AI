import { z } from "zod";

const numberOrUnlimited = z.union([z.coerce.number().int().positive(), z.literal("unlimited")]);

export const createCrawlSchema = z.object({
  url: z.string().url(),
  depth: numberOrUnlimited.default(2),
  maxPages: numberOrUnlimited.default(50),
  downloadImages: z.boolean().default(true),
  downloadVideos: z.boolean().default(false),
  downloadDocuments: z.boolean().default(false),
  exportType: z.enum(["markdown", "json", "both"]).default("both"),
  domainMode: z.enum(["internal", "internal_external"]).default("internal")
});

export type CreateCrawlInput = z.infer<typeof createCrawlSchema>;
