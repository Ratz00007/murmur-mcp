/**
 * Discourse forum source — any Discourse instance exposing read-only JSON.
 *
 * Usage: --forum https://meta.discourse.org
 * Flow: /search.json?q=<q> (topics listing) then /t/<id>.json (full topic
 * with post_stream; includes reply_to_post_number for reply structure).
 * The topic JSON is self-contained; parse() emits the thread from it.
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, plainText, threadFrom } from "./_shared.mjs";

const id = "discourse";

function forumBase(ctx) {
  const base = (ctx?.forum || ctx?.state?.forumBase || "").replace(/\/+$/, "");
  if (!base) throw new Error("discourse source requires --forum <base URL>");
  return base;
}

export function buildDiscourseThread(topicJson, forum, ctx) {
  const postsRaw = topicJson?.post_stream?.posts;
  if (!topicJson?.id || !Array.isArray(postsRaw) || postsRaw.length === 0) return [];
  const posts = [];
  for (const p of postsRaw) {
    const post = {
      postId: String(p.post_number ?? p.id),
      author: p.username || p.name || "unknown",
      text: htmlToText(p.cooked || ""),
      timestamp: isoFrom(p.created_at),
      score: likeCountOf(p),
    };
    if (p.reply_to_post_number && Number(p.reply_to_post_number) !== Number(p.post_number)) {
      post.parentId = String(p.reply_to_post_number);
    }
    posts.push(post);
  }
  const root = postsRaw[0];
  const author = topicJson.details?.created_by?.username || root.username || "unknown";
  return [
    threadFrom({
      platform: "discourse",
      via: "discourse",
      threadId: String(topicJson.id),
      title: plainText(topicJson.title) || "(untitled)",
      author,
      url: `${forum}/t/${topicJson.slug || topicJson.id}/${topicJson.id}`,
      timestamp: root.created_at,
      metrics: {
        upvotes: 0,
        comments: Number(topicJson.posts_count) > 0 ? Number(topicJson.posts_count) - 1 : posts.length - 1,
      },
      posts,
      ctx,
    }),
  ];
}

function likeCountOf(post) {
  const summary = Array.isArray(post?.actions_summary) ? post.actions_summary : [];
  const like = summary.find((a) => a && (a.id === 2 || a.id === "2"));
  return Number(like?.count) || 0;
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  const topicMatch = /\/t\/[^/]*?(\d+)(?:\/\d+)?\.json/.exec(url);
  if (topicMatch) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const forum = (ctx.forum || new URL(url).origin).replace(/\/+$/, "");
    return buildDiscourseThread(data, forum, ctx);
  }
  // search.json listing: stash topic ids in visit order
  try {
    const data = JSON.parse(rawBody);
    ctx.state.discourseTopics = ctx.state.discourseTopics || [];
    for (const topic of data?.topics || []) {
      if (topic?.id && !ctx.state.discourseTopics.some((t) => t.id === topic.id)) {
        ctx.state.discourseTopics.push(topic);
      }
    }
  } catch {
    /* non-JSON — nothing to stash */
  }
  return [];
}

export async function collect({ query, limit = 10, forum, state = {} } = {}) {
  const threads = [];
  const base = forumBase({ forum, state });
  state.forumBase = base;
  if (!query) return threads;
  const searchUrl = `${base}/search.json?q=${encodeURIComponent(query)}`;
  const searchRes = await fetchJsonOrText(searchUrl);
  const searchCtx = { url: searchUrl, retrievedAt: searchRes.retrievedAt, sha256: searchRes.sha256, query, limit, forum: base, state, via: id };
  parse(searchRes.body, searchCtx);
  for (const topic of (state.discourseTopics || []).slice(0, limit)) {
    const topicUrl = `${base}/t/${topic.id}.json`;
    let res;
    try {
      res = await fetchJsonOrText(topicUrl);
    } catch {
      continue;
    }
    const ctx = { url: topicUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, forum: base, state, via: id };
    threads.push(...parse(res.body, ctx));
  }
  return threads;
}

export default { id, parse, collect };
