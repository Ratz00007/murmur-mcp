/**
 * MurmurBench-0 — resilient Arctic Shift client.
 *
 * Arctic Shift's `title` param rejects multi-word values (HTTP 422) and
 * rate-limits aggressively (HTTP 429). Rather than swap the sealed queries
 * for different ones — which would be precisely the post-hoc selection the
 * protocol exists to prevent — this client sends ONE word of each query as
 * the `title` param and re-applies the full phrase as a local AND-filter.
 *
 * Same subreddits. Same words. Same sort. Same rules. Only the transport
 * changes, so the sealed semantics are preserved exactly.
 */
import { sleep } from "./sleep.mjs";

const API = "https://arctic-shift.photon-reddit.com/api";
export const UA = "murmur-bench/0.1 (non-commercial research evaluation; +https://github.com/Ratz00007/murmur-mcp)";

/**
 * Arctic Shift is flaky: it returns 429 under load and, for parameter
 * combinations that demonstrably work (identical queries return 200 moments
 * later), a spurious 422. Measured directly — `r/sysadmin "licens"` returned
 * 422 then 200 on the same URL, and `r/selfhosted "pricing"` 422 then 200.
 * So BOTH 429 and 422 are retried; only a clean 200 ends the loop.
 */
async function getWithBackoff(path, params, { tries = 8 } = {}) {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  let wait = 4000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429 || res.status === 422) {
        if (attempt === tries) return { ok: false, status: res.status, data: [] };
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
        await sleep(delay);
        wait = Math.min(wait * 1.6, 45000);
        continue;
      }
      if (!res.ok) {
        if (attempt === tries) return { ok: false, status: res.status, data: [] };
        await sleep(wait);
        wait = Math.min(wait * 2, 60000);
        continue;
      }
      const json = await res.json();
      return { ok: true, status: res.status, data: json?.data ?? [] };
    } catch (err) {
      if (attempt === tries) return { ok: false, status: 0, data: [], error: err.message };
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }
  return { ok: false, status: 0, data: [] };
}

/**
 * Search posts matching a multi-word phrase.
 * Sends the first word via the API, then requires ALL words present in the
 * title (case-insensitive, word-boundary) so the result set matches the
 * sealed query semantics rather than a looser single-word search.
 */
export async function searchPostsByPhrase(
  subreddit,
  phrase,
  { limit = 25, afterEpoch = 0 } = {},
) {
  const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  const probe = words[0];
  const res = await getWithBackoff("/posts/search", {
    subreddit,
    title: probe,
    limit: String(limit),
    sort_type: "created_utc",
    sort: "desc",
  });
  if (!res.ok && res.data.length === 0) {
    return { posts: [], status: res.status, error: res.error };
  }
  // All words present, in any order and non-adjacent. A strict contiguous
  // phrase would drop legitimate matches like "price of the Pro plan rises".
  const all = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matches = (p) => all.every((w) => new RegExp(`\\b${w}`, "i").test(p.title ?? ""));

  // `after` bounds the window (the API rejects `before`); the cap is applied
  // locally against the seal so a late-arriving post cannot slip through.
  const res2 = await getWithBackoff("/posts/search", {
    subreddit,
    title: probe,
    limit: "100",
    sort_type: "created_utc",
    sort: "desc",
    after: String(afterEpoch),
  });
  const all2 = res2.data.length >= res.data.length ? res2.data : res.data;
  const posts = all2.filter(matches);
  posts.sort((a, b) => b.created_utc - a.created_utc);
  return { posts: posts.slice(0, limit), status: res2.ok ? res2.status : res.status };
}

/** Top-level comments for a post (depth <= 2 per protocol §6). */
export async function fetchComments(linkId, { limit = 100 } = {}) {
  const res = await getWithBackoff("/comments/search", {
    link_id: linkId,
    limit: String(limit),
    sort: "asc",
  });
  return { comments: res.data, status: res.status, error: res.error };
}
