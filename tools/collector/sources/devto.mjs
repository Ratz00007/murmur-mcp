/**
 * dev.to source — public API, no auth.
 *
 * Articles listing: /api/articles?per_page=N&tag=<tag>. The listing endpoint
 * does NOT support a full-text `q` parameter (verified live 2026-11: passing
 * q returns unfiltered results), so collect() fetches the newest/top articles
 * and filters locally on query terms across title + description + tags.
 * Replies: /api/comments?a_id=<article id> (nested via `children`).
 * Article body lives in body_markdown only on single-article fetches, so the
 * root post text falls back to the description.
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, matchesQuery, plainText, slugifyTag, threadFrom } from "./_shared.mjs";

const id = "devto";
const BASE = "https://dev.to/api";

function flattenComments(nodes, parentId, out, depth) {
  for (const c of nodes || []) {
    const cid = c.id_code || c.id;
    if (!cid) continue;
    out.push({
      postId: `c-${cid}`,
      ...(parentId ? { parentId } : {}),
      author: c.user?.username || "unknown",
      text: htmlToText(c.body_html || c.body_markdown || ""),
      timestamp: isoFrom(c.created_at),
      score: Number(c.positive_reactions_count) || 0,
    });
    if (depth < 64) flattenComments(c.children, `c-${cid}`, out, depth + 1);
  }
}

export function buildDevtoThread(article, comments, ctx) {
  if (!article?.id) return [];
  const rootId = `a-${article.id}`;
  const posts = [
    {
      postId: rootId,
      author: article.user?.username || "unknown",
      text: plainText(article.description) || plainText(article.title) || "",
      timestamp: isoFrom(article.published_at || article.created_at),
      score: Number(article.positive_reactions_count) || 0,
    },
  ];
  flattenComments(comments, rootId, posts, 1);
  return [
    threadFrom({
      platform: "devto",
      via: "devto",
      threadId: String(article.id),
      title: plainText(article.title) || "(untitled)",
      author: article.user?.username || "unknown",
      url: article.url || "",
      timestamp: article.published_at || article.created_at,
      metrics: {
        upvotes: Number(article.positive_reactions_count) || 0,
        comments: Number(article.comments_count) || comments.length,
      },
      posts,
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  if (url.includes("/comments")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const aIdMatch = /[?&]a_id=(\d+)/.exec(url);
    const article = aIdMatch ? ctx.state.devtoCandidates?.get(aIdMatch[1]) : null;
    const comments = Array.isArray(data) ? data : [];
    if (article) return buildDevtoThread(article, comments, ctx);
    if (aIdMatch) {
      ctx.state.devtoComments = ctx.state.devtoComments || new Map();
      ctx.state.devtoComments.set(aIdMatch[1], comments);
    }
    return [];
  }
  if (url.includes("/articles")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    ctx.state.devtoCandidates = ctx.state.devtoCandidates || new Map();
    const threads = [];
    for (const article of data) {
      if (!article?.id) continue;
      const key = String(article.id);
      if (!ctx.state.devtoCandidates.has(key)) ctx.state.devtoCandidates.set(key, article);
      const waiting = ctx.state.devtoComments?.get(key);
      if (waiting) threads.push(...buildDevtoThread(article, waiting, ctx));
    }
    return threads;
  }
  return [];
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  // dev.to has no full-text search: passing q= is silently ignored (verified
  // live 2026-11 — identical results with and without). Strategy: pull a
  // tag-scoped pool for the first query word plus the latest-articles pool,
  // then filter locally on ALL query terms across title/description/tags.
  const pool = 100;
  const firstWord = String(query || "").split(/\s+/).filter(Boolean)[0] || "";
  const tag = firstWord ? slugifyTag(firstWord) : "";
  const pools = [`https://dev.to/api/articles?per_page=${pool}`];
  if (tag) pools.push(`https://dev.to/api/articles?per_page=${pool}&tag=${encodeURIComponent(tag)}`);
  for (const listUrl of pools) {
    let listRes;
    try {
      listRes = await fetchJsonOrText(listUrl);
    } catch {
      continue; // a failed pool must not kill the run
    }
    const listCtx = { url: listUrl, retrievedAt: listRes.retrievedAt, sha256: listRes.sha256, query, limit, state, via: id };
    parse(listRes.body, listCtx);
    state.devtoSource = { retrievedAt: listRes.retrievedAt, sha256: listRes.sha256 };
  }
  let candidates = [...(state.devtoCandidates?.values() || [])];
  if (query) {
    candidates = candidates.filter((a) =>
      matchesQuery(
        `${a.title || ""} ${a.description || ""} ${(a.tag_list || []).join(" ")}`,
        query,
      ),
    );
  }
  for (const article of candidates.slice(0, limit)) {
    const commentsUrl = `${BASE}/comments?a_id=${article.id}`;
    let res;
    try {
      res = await fetchJsonOrText(commentsUrl);
    } catch {
      threads.push(...buildDevtoThread(article, [], { url: commentsUrl, query, limit, state, via: id, ...(state.devtoSource || {}) }));
      continue;
    }
    const ctx = { url: commentsUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, ctx));
  }
  return threads;
}

export default { id, parse, collect };
