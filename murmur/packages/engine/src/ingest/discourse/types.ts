/**
 * Normalized multi-platform discourse schema and adapter contracts.
 * Conforms to PROJECT.md § Interface Contracts (R1).
 */

export interface DiscoursePost {
  postId: string;
  parentId?: string;
  author: string;
  text: string;
  timestamp: string;
  score: number;
  aspects?: Record<string, number>;
}

/**
 * Every platform the normalizer accepts. The first four ship with live
 * adapters; the rest are produced by the offline collector (tools/collector)
 * and ingested as pre-structured threads via seed_add. Keep in sync with
 * tests/e2e/market-twin/helpers/contracts.ts and the seed_add zod enum.
 */
export const DISCOURSE_PLATFORMS = [
  "reddit",
  "hackernews",
  "twitter",
  "github",
  "lobsters",
  "stackexchange",
  "mastodon",
  "bluesky",
  "discourse",
  "devto",
  "rss",
] as const;

export type DiscoursePlatform = (typeof DISCOURSE_PLATFORMS)[number];

/** Provenance stamped by the live collector for real-data threads. */
export interface ThreadProvenance {
  /** ISO-8601 time the record was retrieved. */
  retrievedAt: string;
  /** SHA-256 (hex) of the raw response body the record was parsed from. */
  contentSha256: string;
  /** Collector route id, e.g. "hn-algolia" or "github-rest". */
  via?: string;
}

export interface DiscourseThread {
  platform: DiscoursePlatform;
  threadId: string;
  title: string;
  author: string;
  url: string;
  timestamp: string;
  metrics: {
    upvotes: number;
    comments: number;
    shares?: number;
  };
  posts: DiscoursePost[];
  provenance?: ThreadProvenance;
}

/**
 * Reserved for interface compatibility. The discourse adapters are hermetic
 * (offline-fixture-only) by design: they never read secrets and never touch
 * the network, so every option here is a no-op kept only to preserve the
 * `DiscourseAdapter` contract.
 */
export interface AdapterFetchOptions {
  /** @deprecated No-op — adapters are offline-fixture-only. */
  fixtureFallback?: boolean;
}

export interface DiscourseAdapter {
  readonly platform: DiscoursePlatform;
  fetchThread(threadIdOrUrl: string, options?: AdapterFetchOptions): Promise<DiscourseThread>;
  normalizeThread(rawPayload: unknown): DiscourseThread;
}

export function validateDiscourseThread(obj: unknown): DiscourseThread {
  if (!obj || typeof obj !== "object") {
    throw new Error("DiscourseThread must be an object");
  }
  const t = obj as Partial<DiscourseThread>;
  if (!DISCOURSE_PLATFORMS.includes(t.platform as DiscoursePlatform)) {
    throw new Error(`Invalid platform: ${t.platform}`);
  }
  if (t.provenance !== undefined) {
    const p = t.provenance as Partial<ThreadProvenance> | undefined;
    if (!p || typeof p.retrievedAt !== "string" || Number.isNaN(Date.parse(p.retrievedAt))) {
      throw new Error("Invalid provenance.retrievedAt");
    }
    if (typeof p.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.contentSha256)) {
      throw new Error("Invalid provenance.contentSha256");
    }
  }
  if (!t.threadId || typeof t.threadId !== "string") {
    throw new Error("Missing threadId");
  }
  if (!t.title || typeof t.title !== "string") {
    throw new Error("Missing title");
  }
  if (!t.author || typeof t.author !== "string") {
    throw new Error("Missing author");
  }
  if (!t.url || typeof t.url !== "string") {
    throw new Error("Missing url");
  }
  if (!t.timestamp || typeof t.timestamp !== "string") {
    throw new Error("Missing timestamp");
  }
  if (!t.metrics || typeof t.metrics.upvotes !== "number" || typeof t.metrics.comments !== "number") {
    throw new Error("Invalid metrics");
  }
  if (!Array.isArray(t.posts) || t.posts.length === 0) {
    throw new Error("DiscourseThread must have at least one post");
  }
  for (const p of t.posts) {
    if (!p.postId || typeof p.postId !== "string") {
      throw new Error("Invalid postId");
    }
    if (!p.author || typeof p.author !== "string") {
      throw new Error("Invalid post author");
    }
    if (typeof p.text !== "string") {
      throw new Error("Invalid post text");
    }
    if (typeof p.score !== "number") {
      throw new Error("Invalid post score");
    }
  }
  return t as DiscourseThread;
}
