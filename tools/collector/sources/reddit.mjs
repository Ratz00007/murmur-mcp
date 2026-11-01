/**
 * Reddit source — ARCHIVE route via Arctic Shift (arctic-shift.photon-reddit.com).
 *
 * reddit.com is NEVER fetched by this collector: its robots.txt disallows
 * generic crawlers and the public JSON endpoints are hostile to research
 * clients. Arctic Shift is a community archive of public Reddit data with a
 * small read-only API. Verified live 2026-11:
 *   GET /api/posts/search?subreddit=<sub>&limit=<n>      -> {data:[posts]}
 *   GET /api/comments/search?link_id=<t3_id>&limit=<n>   -> {data:[comments]}
 *
 * The live API does NOT support full-text search (passing q= returns HTTP
 * 400), so collect() pulls the newest posts of the requested subreddit and
 * filters locally on query terms across title + selftext. Query syntax:
 *   --query "r/sysadmin license"   or   --query "subreddit:sysadmin license"
 * (sub may also come from env MURMUR_REDDIT_SUB; without a subreddit the
 * source refuses rather than guessing).
 *
 * The archive throttles bursts with HTTP 422 "Timeout. Maybe slow down a
 * bit" — arcticFetch retries those explicitly with generous backoff.
 */
import { fetchText, backoffBaseMs } from "../http.mjs";
import { isoFrom, matchesQuery, plainText, threadFrom } from "./_shared.mjs";

const id = "reddit";
const BASE = "https://arctic-shift.photon-reddit.com/api";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetchText + explicit retries for Arctic Shift's 422 throttle responses. */
async function arcticFetch(url, ctx, { attempts = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetchText(url);
    if (res.status === 422) {
      lastErr = new Error(`Arctic Shift throttled (HTTP 422): ${url}`);
      await sleep(Math.max(backoffBaseMs() * 2 ** attempt, 5_000));
      continue;
    }
    if (res.status >= 400) {
      throw new Error(`Arctic Shift HTTP ${res.status} for ${url} — ${res.body.slice(0, 200)}`);
    }
    try {
      return { res, data: JSON.parse(res.body) };
    } catch {
      throw new Error(`Arctic Shift returned non-JSON for ${url}`);
    }
  }
  throw lastErr || new Error(`Arctic Shift kept throttling: ${url}`);
}

export function parseSubAndTerms(query) {
  let sub = process.env.MURMUR_REDDIT_SUB || "";
  let rest = String(query || "");
  const rMatch = /(?:^|\s)(?:r\/([\w-]+)|subreddit:([\w-]+))/i.exec(rest);
  if (rMatch) {
    sub = rMatch[1] || rMatch[2];
    rest = rest.replace(rMatch[0], " ");
  }
  const terms = rest.trim();
  if (!sub) {
    throw new Error(
      `reddit (arctic-shift) needs a subreddit: pass --query "r/<sub> <terms>" or set MURMUR_REDDIT_SUB`,
    );
  }
  return { sub, terms };
}

export function buildRedditThread(post, comments, ctx) {
  if (!post?.id) return [];
  const rootId = `t3_${post.id}`;
  const byId = new Set((comments || []).map((c) => c.id));
  const posts = [
    {
      postId: rootId,
      author: post.author || "[deleted]",
      text: plainText(post.selftext) || plainText(post.title) || "",
      timestamp: isoFrom(post.created_utc),
      score: Number(post.score) || 0,
    },
  ];
  for (const c of comments || []) {
    const parentId = c.parent_id && byId.has(c.parent_id.replace(/^t1_/, "")) || c.parent_id && byId.has(c.parent_id)
      ? c.parent_id
      : rootId;
    posts.push({
      postId: c.id,
      parentId,
      author: c.author || "[deleted]",
      text: plainText(c.body),
      timestamp: isoFrom(c.created_utc),
      score: Number(c.score) || 0,
    });
  }
  return [
    threadFrom({
      platform: "reddit",
      via: "reddit",
      threadId: `t3_${post.id}`,
      title: plainText(post.title) || "(untitled)",
      author: post.author || "[deleted]",
      url: post.permalink ? `https://www.reddit.com${post.permalink}` : `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/`,
      timestamp: isoFrom(post.created_utc),
      metrics: {
        upvotes: Number(post.score) || 0,
        comments: Number(post.num_comments) || comments.length,
      },
      posts,
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  if (url.includes("/comments/search")) {
    const linkMatch = /[?&]link_id=([a-z0-9]+)/i.exec(url);
    const comments = safeParse(rawBody);
    if (!comments) return [];
    const postId = linkMatch ? linkMatch[1].replace(/^t3_/, "") : null;
    const post = postId ? ctx.state.redditCandidates?.get(postId) : null;
    if (post) return buildRedditThread(post, comments.data || [], ctx);
    if (postId) {
      ctx.state.redditComments = ctx.state.redditComments || new Map();
      ctx.state.redditComments.set(postId, comments.data || []);
    }
    return [];
  }
  if (url.includes("/posts/search")) {
    const data = safeParse(rawBody);
    if (!data) return [];
    ctx.state.redditCandidates = ctx.state.redditCandidates || new Map();
    const threads = [];
    for (const post of data.data || []) {
      if (!post?.id) continue;
      ctx.state.redditCandidates.set(post.id, post);
      const waiting = ctx.state.redditComments?.get(post.id);
      if (waiting) threads.push(...buildRedditThread(post, waiting, ctx));
    }
    return threads;
  }
  return [];
}

function safeParse(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  const { sub, terms } = parseSubAndTerms(query);
  const pool = Math.min(Math.max(limit * 5, 50), 100);
  const postsUrl = `${BASE}/posts/search?subreddit=${encodeURIComponent(sub)}&limit=${pool}`;
  const { res: postsRes, data: postsData } = await arcticFetch(postsUrl, state);
  const postsCtx = { url: postsUrl, retrievedAt: postsRes.retrievedAt, sha256: postsRes.sha256, query, limit, state, via: id };
  parse(postsRes.body, postsCtx);
  let candidates = [...(state.redditCandidates?.values() || [])];
  if (terms) {
    candidates = candidates.filter((p) => matchesQuery(`${p.title || ""} ${p.selftext || ""}`, terms));
  }
  candidates = candidates.slice(0, limit);
  for (const post of candidates) {
    const commentsUrl = `${BASE}/comments/search?link_id=${post.id}&limit=100`;
    try {
      const { res: commentsRes } = await arcticFetch(commentsUrl, state);
      const ctx = { url: commentsUrl, retrievedAt: commentsRes.retrievedAt, sha256: commentsRes.sha256, query, limit, state, via: id };
      threads.push(...parse(commentsRes.body, ctx));
    } catch {
      // comments unavailable (throttled): emit the post itself
      threads.push(...buildRedditThread(post, [], { ...postsCtx }));
    }
  }
  return threads;
}

export default { id, parse, collect };
