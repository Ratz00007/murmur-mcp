/**
 * Collector-side validation mirroring murmur/packages/engine/src/ingest/discourse/types.ts.
 *
 * validateDiscourseThread in the engine is the shipping contract; this module
 * mirrors its rules exactly (keep in sync!) and adds collector-only checks:
 * - required provenance with ISO retrievedAt + 64-hex sha256
 * - depth cap of 20 on parentId chains (deeper posts are dropped, counted
 *   as reason "depth_capped")
 * - timestamp sanity: parseable, not more than 24h in the future, not before 2005
 * - dedupe by contentSha256 and by platform+threadId
 *
 * API: validateThread(obj) -> { ok, thread?, reasons[] }  (mirrors engine rules
 * plus the extras). applyDepthCap(thread) -> { thread, dropped }.
 * dedupeThreads(threads) -> { threads, dropped }.
 */
import * as crypto from "node:crypto";

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
];

export const MAX_DEPTH = 20;

export function is64Hex(s) {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

/** Parseable, not more than 24h in the future, not before 2005-01-01. */
export function timestampOk(ts, now = Date.now()) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return { ok: false, reason: "unparseable" };
  if (t > now + 24 * 60 * 60 * 1000) return { ok: false, reason: "future" };
  if (t < Date.parse("2005-01-01T00:00:00Z")) return { ok: false, reason: "pre-2005" };
  return { ok: true };
}

function postDepth(post, byId, depthMemo, visiting) {
  if (depthMemo.has(post.postId)) return depthMemo.get(post.postId);
  if (visiting.has(post.postId)) return 1; // cycle: treat as root
  visiting.add(post.postId);
  const depth = post.parentId && byId.has(post.parentId)
    ? postDepth(byId.get(post.parentId), byId, depthMemo, visiting) + 1
    : 1;
  visiting.delete(post.postId);
  depthMemo.set(post.postId, depth);
  return depth;
}

/**
 * Drop posts deeper than MAX_DEPTH along the parentId chain.
 * Posts whose parent was dropped are dropped too (they are deeper by
 * construction). Returns { thread, dropped } — thread is a shallow copy
 * when anything was dropped, otherwise the original object.
 */
export function applyDepthCap(thread) {
  const byId = new Map(thread.posts.map((p) => [p.postId, p]));
  const depthMemo = new Map();
  const kept = [];
  let dropped = 0;
  for (const post of thread.posts) {
    const depth = postDepth(post, byId, depthMemo, new Set());
    if (depth > MAX_DEPTH) dropped += 1;
    else kept.push(post);
  }
  if (dropped === 0) return { thread, dropped };
  if (kept.length === 0) return { thread: null, dropped }; // everything was too deep
  return { thread: { ...thread, posts: kept }, dropped };
}

/**
 * Validate one thread. Mirrors the engine's validateDiscourseThread rules and
 * adds collector checks (required provenance, timestamp sanity). Returns
 * { ok, thread?, reasons[] }. reasons are stable machine-readable strings.
 */
export function validateThread(obj, { now = Date.now(), requireProvenance = true } = {}) {
  const reasons = [];
  if (!obj || typeof obj !== "object") {
    return { ok: false, reasons: ["not-an-object"] };
  }
  const t = obj;
  if (!DISCOURSE_PLATFORMS.includes(t.platform)) reasons.push(`platform:${JSON.stringify(t.platform)}`);
  if (!t.threadId || typeof t.threadId !== "string") reasons.push("missing-threadId");
  if (!t.title || typeof t.title !== "string") reasons.push("missing-title");
  if (!t.author || typeof t.author !== "string") reasons.push("missing-author");
  if (!t.url || typeof t.url !== "string") reasons.push("missing-url");
  if (!t.timestamp || typeof t.timestamp !== "string") reasons.push("missing-timestamp");
  if (
    !t.metrics ||
    typeof t.metrics !== "object" ||
    typeof t.metrics.upvotes !== "number" ||
    typeof t.metrics.comments !== "number"
  ) {
    reasons.push("invalid-metrics");
  }
  if (!Array.isArray(t.posts) || t.posts.length === 0) {
    reasons.push("empty-posts");
  } else {
    t.posts.forEach((p, i) => {
      if (!p || typeof p !== "object") {
        reasons.push(`post[${i}]:not-an-object`);
        return;
      }
      if (!p.postId || typeof p.postId !== "string") reasons.push(`post[${i}]:invalid-postId`);
      if (!p.author || typeof p.author !== "string") reasons.push(`post[${i}]:invalid-author`);
      if (typeof p.text !== "string") reasons.push(`post[${i}]:invalid-text`);
      if (typeof p.score !== "number") reasons.push(`post[${i}]:invalid-score`);
      if (typeof p.timestamp === "string") {
        const check = timestampOk(p.timestamp, now);
        if (!check.ok) reasons.push(`post[${i}]:timestamp-${check.reason}`);
      }
    });
  }
  if (t.provenance !== undefined || requireProvenance) {
    const p = t.provenance;
    if (!p || typeof p !== "object") {
      reasons.push("missing-provenance");
    } else {
      if (typeof p.retrievedAt !== "string" || Number.isNaN(Date.parse(p.retrievedAt))) {
        reasons.push("invalid-provenance-retrievedAt");
      }
      if (!is64Hex(p.contentSha256)) reasons.push("invalid-provenance-contentSha256");
      if (p.via !== undefined && typeof p.via !== "string") {
        reasons.push("invalid-provenance-via");
      }
    }
  }
  if (typeof t.timestamp === "string") {
    const check = timestampOk(t.timestamp, now);
    if (!check.ok) reasons.push(`timestamp-${check.reason}`);
  }
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, thread: t, reasons };
}

/**
 * Validate + normalize: applies the depth cap first, then validation.
 * Returns { ok, thread?, reasons[], droppedDepth }.
 */
export function validateAndNormalize(obj, opts = {}) {
  const capped = applyDepthCap(obj);
  const reasons = [];
  if (capped.dropped > 0) reasons.push(`depth_capped:${capped.dropped}`);
  if (!capped.thread) return { ok: false, reasons: [...reasons, "empty-posts-after-depth-cap"], droppedDepth: capped.dropped };
  const res = validateThread(capped.thread, opts);
  if (!res.ok) return { ok: false, reasons: [...reasons, ...res.reasons], droppedDepth: capped.dropped };
  return { ok: true, thread: res.thread, reasons, droppedDepth: capped.dropped };
}

/**
 * Dedupe a list of validated threads. The identity key is platform+threadId
 * (the same logical thread found twice); the provenance sha distinguishes
 * the two drop reasons:
 * - same key AND same response sha -> "duplicate-sha256" (re-fetched run)
 * - same key, different sha        -> "duplicate-platform-threadId" (edited or
 *   re-collected thread; first wins)
 *
 * Threads from ONE batch response (StackExchange answer pages, RSS feeds,
 * empty Mastodon contexts) legitimately share a response sha but have
 * distinct threadIds, so they are kept.
 * Returns { threads, dropped } where dropped is an array of
 * { reason, threadId } entries.
 */
export function dedupeThreads(threads) {
  const byId = new Map(); // idKey -> sha
  const kept = [];
  const dropped = [];
  for (const t of threads) {
    const sha = t?.provenance?.contentSha256;
    const idKey = `${t.platform}::${t.threadId}`;
    if (byId.has(idKey)) {
      dropped.push({
        reason: byId.get(idKey) === sha ? "duplicate-sha256" : "duplicate-platform-threadId",
        threadId: t.threadId,
      });
      continue;
    }
    byId.set(idKey, sha);
    kept.push(t);
  }
  return { threads: kept, dropped };
}

/** Convenience for sources: sha256 of a raw response body. */
export function sha256Of(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
