/**
 * Mastodon source — mastodon.social public endpoints.
 *
 * Preferred: /api/v2/search?type=statuses&q= (public status search; verified
 * live 2026-11: works unauthenticated for statuses). Fallback when search
 * requires auth or fails: /api/v1/timelines/tag/<tag> (hashtag timeline) with
 * local query-term filtering.
 * Replies: /api/v1/statuses/<id>/context (descendants attach under their
 * in_reply_to parent when present in the set, else under the root).
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, matchesQuery, slugifyTag, threadFrom } from "./_shared.mjs";

const id = "mastodon";
const BASE = "https://mastodon.social";

function buildPosts(root, descendants) {
  const rootId = String(root.id);
  const byId = new Map(descendants.map((s) => [String(s.id), s]));
  const posts = [
    {
      postId: rootId,
      author: root.account?.acct || "unknown",
      text: htmlToText(root.content || ""),
      timestamp: isoFrom(root.created_at),
      score: Number(root.favourites_count) || 0,
    },
  ];
  for (const s of descendants) {
    const sid = String(s.id);
    const parentInSet = s.in_reply_to_id && byId.has(String(s.in_reply_to_id));
    posts.push({
      postId: sid,
      parentId: parentInSet ? String(s.in_reply_to_id) : rootId,
      author: s.account?.acct || "unknown",
      text: htmlToText(s.content || ""),
      timestamp: isoFrom(s.created_at),
      score: Number(s.favourites_count) || 0,
    });
  }
  return posts;
}

export function buildMastodonThread(status, descendants, ctx) {
  if (!status?.id) return [];
  return [
    threadFrom({
      platform: "mastodon",
      via: "mastodon",
      threadId: String(status.id),
      title: (htmlToText(status.content || "").split("\n")[0] || "(untitled)").slice(0, 140),
      author: status.account?.acct || "unknown",
      url: status.url || `${BASE}/@${status.account?.acct}/${status.id}`,
      timestamp: status.created_at,
      metrics: {
        upvotes: Number(status.favourites_count) || 0,
        comments: Number(status.replies_count) || descendants.length,
      },
      posts: buildPosts(status, descendants),
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  const contextMatch = /\/statuses\/(\d+)\/context/.exec(url);
  if (contextMatch) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const status = ctx.state.mastoCandidates?.get(contextMatch[1]);
    if (status) return buildMastodonThread(status, data?.descendants || [], ctx);
    ctx.state.mastoContexts = ctx.state.mastoContexts || new Map();
    ctx.state.mastoContexts.set(contextMatch[1], data?.descendants || []);
    return [];
  }
  // search v2 or tag timeline: both return an array or {statuses: [...]}
  try {
    const data = JSON.parse(rawBody);
    const statuses = Array.isArray(data) ? data : data?.statuses || [];
    ctx.state.mastoCandidates = ctx.state.mastoCandidates || new Map();
    for (const s of statuses) {
      if (s?.id && !s.in_reply_to_id && !ctx.state.mastoCandidates.has(String(s.id))) {
        ctx.state.mastoCandidates.set(String(s.id), s);
      }
    }
  } catch {
    /* non-JSON body — nothing to stash */
  }
  return [];
}

async function trySearch(query, limit, state) {
  const url = `${BASE}/api/v2/search?type=statuses&q=${encodeURIComponent(query)}&limit=${limit}`;
  try {
    const res = await fetchJsonOrText(url);
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    const data = JSON.parse(res.body);
    const statuses = data?.statuses || [];
    parse(res.body, ctx);
    state.mastoSource = { retrievedAt: res.retrievedAt, sha256: res.sha256 };
    return statuses.length > 0;
  } catch {
    return false;
  }
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  let found = false;
  if (query) found = await trySearch(query, limit, state);
  if (!found) {
    // Fallback: public hashtag timeline for the first query word, filtered
    // locally on the remaining terms (documented in README).
    const firstWord = String(query || "").split(/\s+/).filter(Boolean)[0] || "opensource";
    const tag = slugifyTag(firstWord);
    const url = `${BASE}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${Math.max(limit, 20)}`;
    const res = await fetchJsonOrText(url);
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    parse(res.body, ctx);
    state.mastoSource = { retrievedAt: res.retrievedAt, sha256: res.sha256 };
    for (const s of state.mastoCandidates?.values() || []) {
      if (!matchesQuery(`${s.content} ${s.account?.acct || ""}`, query)) {
        state.mastoCandidates.delete(String(s.id));
      }
    }
  }
  for (const status of [...(state.mastoCandidates?.values() || [])].slice(0, limit)) {
    const url = `${BASE}/api/v1/statuses/${status.id}/context`;
    let res;
    try {
      res = await fetchJsonOrText(url);
    } catch (err) {
      if (process.env.MURMUR_COLLECTOR_DEBUG) console.error(`context fetch failed for ${url}: ${err.message}`);
      // Context fetch failed: emit the status alone, stamped with the
      // search/timeline response it actually came from.
      const src = state.mastoSource || { retrievedAt: res?.retrievedAt, sha256: "" };
      if (src.sha256) {
        threads.push(...buildMastodonThread(status, [], { url, query, limit, state, via: id, ...src }));
      }
      continue;
    }
    const ctx = { url, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, ctx));
  }
  return threads;
}

export default { id, parse, collect };
