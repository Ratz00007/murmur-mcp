/**
 * Bluesky source — public AppView endpoints, no auth required.
 *
 * Search: public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=&limit=
 * Replies: app.bsky.feed.getPostThread?uri=<at-uri> (self-contained tree).
 * A search hit whose thread fetch fails is emitted as a single-post thread,
 * stamped with the search response it came from.
 */
import { fetchJsonOrText } from "../http.mjs";
import { isoFrom, plainText, threadFrom } from "./_shared.mjs";

const id = "bluesky";
// api.bsky.app is the same public AppView as public.api.bsky.app (no auth);
// the public.api host was observed returning 403 to some networks, while
// api.bsky.app answers (verified live 2026-11). robots.txt allows crawling
// the public API on both hosts.
const BASE = "https://api.bsky.app";

function postOf(node) {
  return node?.post || node;
}

export function buildBlueskyThread(threadNode, ctx) {
  const root = postOf(threadNode);
  if (!root?.uri && !root?.cid) return [];
  const rootId = root.cid || root.uri;
  const rootAuthor = root.author?.handle || root.author?.did || "unknown";
  const posts = [
    {
      postId: String(rootId),
      author: rootAuthor,
      text: plainText(root.record?.text),
      timestamp: isoFrom(root.record?.createdAt || root.indexedAt),
      score: Number(root.likeCount) || 0,
    },
  ];
  const walkReplies = (replies, depth) => {
    for (const r of replies || []) {
      if (r?.$type === "app.bsky.feed.defs#notFoundPost" || (!r.post && !r.cid)) continue;
      const p = postOf(r);
      posts.push({
        postId: String(p.cid || p.uri),
        parentId: String(rootId),
        author: p.author?.handle || p.author?.did || "unknown",
        text: plainText(p.record?.text),
        timestamp: isoFrom(p.record?.createdAt || p.indexedAt),
        score: Number(p.likeCount) || 0,
      });
      if (depth < 64) walkReplies(r.replies, depth + 1);
    }
  };
  walkReplies(threadNode?.replies, 1);
  return [
    threadFrom({
      platform: "bluesky",
      via: "bluesky",
      threadId: String(root.uri || rootId),
      title: (plainText(root.record?.text).split("\n")[0] || "(untitled)").slice(0, 140),
      author: rootAuthor,
      url: bskyUrl(root),
      timestamp: root.record?.createdAt || root.indexedAt,
      metrics: {
        upvotes: Number(root.likeCount) || 0,
        comments: Number(root.replyCount) || posts.length - 1,
      },
      posts,
      ctx,
    }),
  ];
}

function bskyUrl(post) {
  const handle = post.author?.handle;
  const rkey = (post.uri || "").split("/").pop();
  return handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : String(post.uri || "");
}

export function buildBlueskySingle(post, ctx) {
  if (!post?.uri) return [];
  return [
    threadFrom({
      platform: "bluesky",
      via: "bluesky",
      threadId: String(post.uri),
      title: (plainText(post.record?.text).split("\n")[0] || "(untitled)").slice(0, 140),
      author: post.author?.handle || post.author?.did || "unknown",
      url: bskyUrl(post),
      timestamp: post.record?.createdAt || post.indexedAt,
      metrics: {
        upvotes: Number(post.likeCount) || 0,
        comments: Number(post.replyCount) || 0,
      },
      posts: [
        {
          postId: String(post.cid || post.uri),
          author: post.author?.handle || post.author?.did || "unknown",
          text: plainText(post.record?.text),
          timestamp: isoFrom(post.record?.createdAt || post.indexedAt),
          score: Number(post.likeCount) || 0,
        },
      ],
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  if (url.includes("getPostThread")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    return buildBlueskyThread(data?.thread || {}, ctx);
  }
  if (url.includes("searchPosts")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    ctx.state.bskyCandidates = ctx.state.bskyCandidates || new Map();
    for (const post of data?.posts || []) {
      if (post?.uri) ctx.state.bskyCandidates.set(post.uri, post);
    }
    stateStamp(ctx, data);
    return [];
  }
  return [];
}

function stateStamp(ctx, data) {
  ctx.state.bskySource = { retrievedAt: ctx.retrievedAt, sha256: ctx.sha256 };
  return data;
}

export async function collect({ query, limit = 25, state = {} } = {}) {
  const threads = [];
  if (!query) return threads;
  const searchUrl = `${BASE}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${limit}`;
  const searchRes = await fetchJsonOrText(searchUrl);
  const searchCtx = { url: searchUrl, retrievedAt: searchRes.retrievedAt, sha256: searchRes.sha256, query, limit, state, via: id };
  parse(searchRes.body, searchCtx);
  for (const post of [...(state.bskyCandidates?.values() || [])].slice(0, limit)) {
    const threadUrl = `${BASE}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(post.uri)}`;
    let res;
    try {
      res = await fetchJsonOrText(threadUrl);
    } catch {
      threads.push(...buildBlueskySingle(post, { url: searchUrl, query, limit, state, via: id, ...state.bskySource }));
      continue;
    }
    const ctx = { url: threadUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    threads.push(...parse(res.body, ctx));
  }
  return threads;
}

export default { id, parse, collect };
