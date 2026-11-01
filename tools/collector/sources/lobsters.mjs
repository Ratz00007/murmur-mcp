/**
 * Lobsters source — JSON endpoints on lobste.rs.
 *
 * Story+comments come from /s/<short_id>.json (self-contained).
 * Discovery: lobste.rs exposes /search.json?q=<q>&what=stories&order=newest
 * (verified live 2026-11). If the search endpoint ever disappears or returns
 * non-JSON, collect() falls back to /newest.json and filters stories by
 * query-term matching on title + description + tags.
 *
 * Be gentle: lobste.rs is a small community site; the shared 1 req/s limiter
 * is intentional. Their robots.txt disallows some crawlers — the shared
 * robots gate will refuse if the rules ever cover us (clear error).
 */
import { fetchJsonOrText } from "../http.mjs";
import { isoFrom, matchesQuery, plainText, threadFrom } from "./_shared.mjs";

const id = "lobsters";
const BASE = "https://lobste.rs";

export function buildLobstersThread(story, comments, ctx) {
  if (!story?.short_id) return [];
  const rootId = `t-${story.short_id}`;
  const posts = [
    {
      postId: rootId,
      author: story.submitter_user?.username || story.submitter || "unknown",
      text: plainText(story.description) || plainText(story.title) || "",
      timestamp: isoFrom(story.created_at),
      score: Number(story.score) || 0,
    },
  ];
  const byCommentId = new Map();
  for (const c of comments || []) {
    byCommentId.set(c.short_id, c);
  }
  for (const c of comments || []) {
    const parent = c.parent_comment_id
      ? byCommentId.has(c.parent_comment_id)
        ? `c-${c.parent_comment_id}`
        : rootId
      : rootId;
    posts.push({
      postId: `c-${c.short_id}`,
      parentId: parent,
      author: c.commenter || c.username || "unknown",
      text: plainText(c.comment),
      timestamp: isoFrom(c.created_at),
      score: Number(c.score) || 0,
    });
  }
  return [
    threadFrom({
      platform: "lobsters",
      via: "lobsters",
      threadId: story.short_id,
      title: plainText(story.title) || "(untitled)",
      author: story.submitter_user?.username || story.submitter || "unknown",
      url: story.comments_url || `${BASE}/s/${story.short_id}`,
      timestamp: story.created_at,
      metrics: {
        upvotes: Number(story.score) || 0,
        comments: Number(story.comment_count) || (comments ? comments.length : 0),
      },
      posts,
      ctx,
    }),
  ];
}

/** Stash stories from a listing/search body; returns [] (no full threads). */
function stashStories(data, ctx) {
  const stories = Array.isArray(data) ? data : data?.results || [];
  ctx.state.lobstersCandidates = ctx.state.lobstersCandidates || [];
  for (const s of stories) {
    if (s?.short_id && !ctx.state.lobstersCandidates.some((x) => x.short_id === s.short_id)) {
      ctx.state.lobstersCandidates.push(s);
    }
  }
  return [];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  const storyMatch = /\/s\/([a-z0-9]+)\.json/.exec(url);
  if (storyMatch) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const story = data?.story || data;
    return buildLobstersThread(story, data?.comments || [], ctx);
  }
  try {
    return stashStories(JSON.parse(rawBody), ctx);
  } catch {
    return [];
  }
}

/** Try the live search JSON endpoint; report whether it yielded stories. */
async function trySearch(query, limit, state) {
  const url = `${BASE}/search.json?q=${encodeURIComponent(query)}&what=stories&order=newest&page=1`;
  try {
    const res = await fetchJsonOrText(url);
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    const data = JSON.parse(res.body);
    const stories = Array.isArray(data) ? data : data?.results || [];
    parse(res.body, ctx);
    return stories.length > 0;
  } catch {
    return false;
  }
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  let found = false;
  if (query) found = await trySearch(query, limit, state);
  let candidates = state.lobstersCandidates || [];
  if (!found) {
    // Fallback: newest.json + local query-term filter (documented in README).
    const url = `${BASE}/newest.json?page=1`;
    const res = await fetchJsonOrText(url);
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    parse(res.body, ctx);
    candidates = state.lobstersCandidates || [];
    if (query) {
      candidates = candidates.filter((s) =>
        matchesQuery(`${s.title} ${s.description || ""} ${(s.tags || []).join(" ")}`, query),
      );
    }
  }
  for (const story of candidates.slice(0, limit)) {
    const url = `${BASE}/s/${story.short_id}.json`;
    let res;
    try {
      res = await fetchJsonOrText(url);
    } catch {
      continue;
    }
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, ctx));
  }
  return threads;
}

export default { id, parse, collect };
