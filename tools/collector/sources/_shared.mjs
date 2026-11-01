/**
 * Shared helpers for collector source modules.
 *
 * Every source exports { id, parse(rawBody, ctx), collect(options) }:
 * - parse(rawBody, ctx) -> DiscourseThread[] (0..n complete threads from one
 *   raw response body). Listing/search bodies usually return [] and stash
 *   candidates into ctx.state so the per-thread response can be paired later.
 * - collect(options) -> async generator or array of threads; it performs the
 *   live fetches through ../http.mjs (fetchText) and routes every body through
 *   parse() so the cassette-replay tests exercise the exact same code path.
 *
 * ctx for parse: { url, retrievedAt, sha256, query, forum, limit, since, state }
 * state is a plain object shared across one collect run (and one cassette
 * replay), letting multi-response sources pair listings with detail bodies.
 */

/** Trim without HTML stripping (markdown bodies must survive). */
export function plainText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Decode HTML entities and convert block tags to newlines. */
export function htmlToText(html) {
  if (typeof html !== "string") return "";
  let s = html;
  s = s.replace(/<\s*(br|BR)\s*\/?>/g, "\n");
  s = s.replace(/<\s*(p|P)\b[^>]*>/g, "\n");
  s = s.replace(/<\s*\/\s*(p|P)\s*>/g, "\n");
  s = s.replace(/<\s*(li|LI)\b[^>]*>/g, "\n- ");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;|&#47;/g, "/")
    .replace(/&#x3D;|&#61;/g, "=")
    .replace(/&amp;/g, "&");
  s = s.replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(Number(d)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(Number.parseInt(h, 16)));
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function safeFromCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Wrap a list of posts so the first one always exists (root fallback). */
export function rootPost({ postId, author, text, timestamp, score, parentId }) {
  const post = {
    postId: String(postId),
    author: String(author || "unknown"),
    text: String(text ?? ""),
    timestamp: isoFrom(timestamp),
    score: Number(score) || 0,
  };
  if (parentId !== undefined && parentId !== null) post.parentId = String(parentId);
  return post;
}

/** Best-effort ISO-8601 conversion. Returns '' when unparseable. */
export function isoFrom(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") {
    // seconds vs milliseconds heuristics
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

export function provenance(ctx) {
  return {
    retrievedAt: ctx.retrievedAt,
    contentSha256: ctx.sha256,
    via: ctx.via,
  };
}

export function threadFrom({ platform, via, threadId, title, author, url, timestamp, metrics, posts, ctx }) {
  return {
    platform,
    threadId: String(threadId),
    title: String(title ?? ""),
    author: String(author ?? "unknown"),
    url: String(url ?? ""),
    timestamp: isoFrom(timestamp) || new Date(0).toISOString(),
    metrics: {
      upvotes: Number(metrics?.upvotes) || 0,
      comments: Number(metrics?.comments) || 0,
    },
    posts,
    provenance: provenance({ ...ctx, via }),
  };
}

/** True when every whitespace-separated query term appears in the haystack. */
export function matchesQuery(haystack, query) {
  if (!query) return true;
  const hay = String(haystack).toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function slugifyTag(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9]/g, "");
}
