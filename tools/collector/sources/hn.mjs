/**
 * Hacker News source — Algolia public API (no auth, permissive robots).
 *
 * Flow: search?query=&tags=story&hitsPerPage=N  ->  items/<objectID> (full
 * comment tree). The items response is self-contained; parse() emits the
 * thread from it. Comment text arrives as HTML: entities are decoded and <p>
 * becomes newlines.
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, threadFrom } from "./_shared.mjs";

const id = "hn";
const BASE = "https://hn.algolia.com/api/v1";

function walkComments(children, parentId, out, depth) {
  for (const child of children || []) {
    const postId = String(child.id);
    out.push({
      postId,
      ...(parentId ? { parentId } : {}),
      author: child.author || "[deleted]",
      text: htmlToText(child.text || ""),
      timestamp: isoFrom(child.created_at),
      score: Number(child.points) || 0,
    });
    if (depth < 64) walkComments(child.children, postId, out, depth + 1);
  }
}

function countComments(children) {
  let n = 0;
  for (const c of children || []) {
    n += 1 + countComments(c.children);
  }
  return n;
}

export function parseItemThread(item, ctx) {
  if (!item || item.id === undefined) return [];
  const posts = [];
  posts.push({
    postId: String(item.id),
    author: item.author || "[deleted]",
    text: htmlToText(item.text || item.title || ""),
    timestamp: isoFrom(item.created_at),
    score: Number(item.points) || 0,
  });
  walkComments(item.children, String(item.id), posts, 1);
  const url = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
  const hit = ctx?.state?.hnCandidates?.get(String(item.id));
  return [
    threadFrom({
      platform: "hackernews",
      via: "hn",
      threadId: String(item.id),
      title: item.title || "(untitled)",
      author: item.author || "[deleted]",
      url,
      timestamp: item.created_at,
      metrics: {
        upvotes: Number(item.points) || 0,
        comments: Number(hit?.num_comments) || countComments(item.children),
      },
      posts,
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  if (url.includes("/items/")) {
    let item;
    try {
      item = JSON.parse(rawBody);
    } catch {
      return [];
    }
    return parseItemThread(item, ctx);
  }
  // search listing: stash candidates, emit nothing
  try {
    const data = JSON.parse(rawBody);
    ctx.state.hnCandidates = new Map();
    for (const hit of data?.hits || []) {
      ctx.state.hnCandidates.set(String(hit.objectID), hit);
    }
  } catch {
    /* not JSON — nothing to stash */
  }
  return [];
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  if (!query) return threads;
  const searchUrl = `${BASE}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const searchRes = await fetchJsonOrText(searchUrl);
  const searchCtx = { url: searchUrl, retrievedAt: searchRes.retrievedAt, sha256: searchRes.sha256, query, limit, state, via: id };
  parse(searchRes.body, searchCtx);
  const hits = [...(searchCtx.state.hnCandidates?.values() || [])];
  for (const hit of hits) {
    const itemUrl = `${BASE}/items/${hit.objectID}`;
    let res;
    try {
      res = await fetchJsonOrText(itemUrl);
    } catch {
      continue; // a single un-fetchable story must not kill the run
    }
    const itemCtx = { url: itemUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, { ...itemCtx, state: { ...state, hnCandidates: searchCtx.state.hnCandidates } }));
  }
  return threads;
}

export default { id, parse, collect };
