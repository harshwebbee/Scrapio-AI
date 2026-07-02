export type ExportType = "markdown" | "json" | "both";
export type DomainMode = "internal" | "internal_external";

export type CrawlConfig = {
  url: string;
  depth: number | "unlimited";
  maxPages: number | "unlimited";
  downloadImages: boolean;
  downloadVideos: boolean;
  downloadDocuments: boolean;
  exportType: ExportType;
  domainMode: DomainMode;
  outputDir: string;
};

export type PageMetadata = {
  title: string;
  description: string;
  keywords: string[];
  canonical_url: string;
  og_title: string;
  og_description: string;
  og_image: string;
  language: string;
  author: string;
};

export type ExtractedLink = {
  text: string;
  url: string;
  type: "internal" | "external";
};

export type ExtractedAsset = {
  type: "image" | "video" | "document";
  url: string;
  filename: string;
  localPath?: string;
};

export type ExtractedPage = {
  url: string;
  path: string;
  title: string;
  content: string;
  markdown: string;
  markdownPath?: string;
  jsonPath?: string;
  statusCode?: number;
  headings: string[];
  links: ExtractedLink[];
  images: ExtractedAsset[];
  videos: ExtractedAsset[];
  documents: ExtractedAsset[];
  metadata: PageMetadata;
};

export type AiChunk = {
  chunk_id: string;
  page: string;
  page_url?: string;
  content: string;
  embedding_ready: true;
};

export type CrawlProgress = {
  currentUrl?: string;
  pagesProcessed: number;
  remainingQueue: number;
  pagesCrawled: number;
  assetsDownloaded: number;
  imagesFound: number;
  videosFound: number;
  documentsFound: number;
  totalContentSize: number;
  status: "queued" | "running" | "completed" | "failed";
  message?: string;
};

export type CrawlResult = {
  website: string;
  crawl_date: string;
  pages: ExtractedPage[];
  chunks: AiChunk[];
  summary: CrawlProgress;
  outputDir: string;
};
