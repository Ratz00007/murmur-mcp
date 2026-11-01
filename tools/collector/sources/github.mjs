/**
 * GitHub source — public REST search for issues plus per-issue comments.
 *
 * Optional env GITHUB_TOKEN raises the rate limit (sent as
 * 'Authorization: Bearer <token>'). threadId is '<owner>/<repo>#<number>'.
 * The root post comes from the issue body (search response); comments are
 * attached flat under the root (GitHub REST has no nesting).
 */
import { fetchJsonOrText, fetchText } from "../http.mjs";
import { isoFrom, plainText, threadFrom } from "./_shared.mjs";

const id = "github";
const BASE = "https://api.github.com";

function authHeaders() {
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function repoOwnerName(repositoryUrl) {
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(repositoryUrl || "");
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function issueKey(owner, repo, number) {
  return `${owner}/${repo}#${number}`;
}

export function buildGithubThread(item, comments, ctx) {
  const ref = repoOwnerName(item.repository_url);
  if (!ref) return [];
  const { owner, repo } = ref;
  const rootId = `issue-${item.number}`;
  const posts = [
    {
      postId: rootId,
      author: item.user?.login || "ghost",
      text: plainText(item.body || item.title || ""),
      timestamp: isoFrom(item.created_at),
      score: Number(item.reactions?.total_count) || 0,
    },
  ];
  for (const c of comments) {
    posts.push({
      postId: `comment-${c.id}`,
      parentId: rootId,
      author: c.user?.login || "ghost",
      text: plainText(c.body || ""),
      timestamp: isoFrom(c.created_at),
      score: Number(c.reactions?.total_count) || 0,
    });
  }
  return [
    threadFrom({
      platform: "github",
      via: "github",
      threadId: issueKey(owner, repo, item.number),
      title: item.title || "(untitled)",
      author: item.user?.login || "ghost",
      url: item.html_url || `https://github.com/${owner}/${repo}/issues/${item.number}`,
      timestamp: item.created_at,
      metrics: {
        upvotes: Number(item.reactions?.total_count) || 0,
        comments: Number(item.comments) || comments.length,
      },
      posts,
      ctx,
    }),
  ];
}

export function parse(rawBody, ctx) {
  const url = ctx.url || "";
  const commentsMatch = /\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments/.exec(url);
  if (commentsMatch) {
    let comments;
    try {
      comments = JSON.parse(rawBody);
    } catch {
      return [];
    }
    const [, owner, repo, number] = commentsMatch;
    const key = issueKey(owner, repo, Number(number));
    const item = ctx.state.githubCandidates?.get(key);
    if (item) return buildGithubThread(item, Array.isArray(comments) ? comments : [], ctx);
    // candidate not seen yet (offline replay out of order): stash and wait
    ctx.state.githubComments = ctx.state.githubComments || new Map();
    ctx.state.githubComments.set(key, Array.isArray(comments) ? comments : []);
    return [];
  }
  if (url.includes("/search/issues")) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return [];
    }
    ctx.state.githubCandidates = ctx.state.githubCandidates || new Map();
    const threads = [];
    for (const item of data?.items || []) {
      const ref = repoOwnerName(item.repository_url);
      if (!ref) continue;
      const key = issueKey(ref.owner, ref.repo, item.number);
      ctx.state.githubCandidates.set(key, item);
      const waiting = ctx.state.githubComments?.get(key);
      if (waiting) {
        threads.push(...buildGithubThread(item, waiting, ctx));
      }
    }
    return threads;
  }
  return [];
}

export async function collect({ query, limit = 10, state = {} } = {}) {
  const threads = [];
  if (!query) return threads;
  const q = `${query} is:issue`;
  const searchUrl = `${BASE}/search/issues?q=${encodeURIComponent(q)}&sort=comments&order=desc&per_page=${limit}`;
  const searchRes = await fetchText(searchUrl, { headers: authHeaders() });
  if (searchRes.status >= 400) {
    throw new Error(`GitHub search failed: HTTP ${searchRes.status} — ${searchRes.body.slice(0, 200)}`);
  }
  const searchCtx = { url: searchUrl, retrievedAt: searchRes.retrievedAt, sha256: searchRes.sha256, query, limit, state, via: id };
  for (const t of parse(searchRes.body, searchCtx)) threads.push(t);
  const items = dataItems(searchRes.body);
  for (const item of items) {
    const ref = repoOwnerName(item.repository_url);
    if (!ref) continue;
    const commentsUrl = `${BASE}/repos/${ref.owner}/${ref.repo}/issues/${item.number}/comments?per_page=100`;
    let res;
    try {
      res = await fetchText(commentsUrl, { headers: authHeaders() });
    } catch {
      continue;
    }
    if (res.status >= 400) continue;
    const ctx2 = { url: commentsUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query, limit, state, via: id };
    for (const t of parse(res.body, ctx2)) threads.push(t);
  }
  return threads;
}

function dataItems(body) {
  try {
    return JSON.parse(body)?.items || [];
  } catch {
    return [];
  }
}

export default { id, parse, collect };
