/**
 * RSS/Atom feed source — minimal dependency-free XML scanning.
 *
 * No XML parser: indexOf-based extraction of <item> (RSS) or <entry> (Atom)
 * blocks, then per-block extraction of title / link / updated / published /
 * pubDate / description / content:encoded / content / author. Each entry
 * becomes a single-post thread. Feed URL comes from --query (or the forum
 * slot); e.g. --source rss --query https://github.blog/feed/
 */
import { fetchJsonOrText } from "../http.mjs";
import { htmlToText, isoFrom, threadFrom } from "./_shared.mjs";

const id = "rss";

function extractBlock(body, tag, from) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const start = body.indexOf(open, from);
  if (start === -1) return null;
  const end = body.indexOf(close, start);
  if (end === -1) return null;
  return { block: body.slice(start, end + close.length), next: end + close.length };
}

/** First <tag>...</tag> inside block; falls back to <tag ... href="..."/> for links. */
function extractField(block, tag) {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i");
  const openMatch = openRe.exec(block);
  if (openMatch) {
    const start = openMatch.index + openMatch[0].length;
    const end = block.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
    if (end !== -1) {
      const text = block.slice(start, end);
      if (text.trim() !== "") return text;
    }
  }
  // Atom self-closing <link rel="alternate" href="..." />
  if (tag === "link") {
    const m = /<link\b[^>]*href="([^"]+)"[^>]*\/?>/i.exec(block);
    if (m) return m[1];
  }
  return "";
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function stripCdata(s) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return m ? m[1] : s;
}

export function parseFeed(rawBody, ctx) {
  const threads = [];
  let cursor = 0;
  let guard = 0;
  for (;;) {
    if (guard++ > 2000) break;
    let entry = extractBlock(rawBody, "item", cursor);
    if (!entry) entry = extractBlock(rawBody, "entry", cursor);
    if (!entry) break;
    cursor = entry.next;
    const block = entry.block;
    const title = htmlToText(stripCdata(extractField(block, "title")));
    let link = stripCdata(extractField(block, "link")).trim();
    if (!link) link = stripCdata(extractField(block, "guid")).trim();
    const published = firstNonEmpty(
      extractField(block, "pubDate"),
      extractField(block, "published"),
      extractField(block, "updated"),
      extractField(block, "dc:date"),
    );
    const contentRaw = firstNonEmpty(
      extractField(block, "content:encoded"),
      extractField(block, "content"),
      extractField(block, "description"),
      extractField(block, "summary"),
    );
    const author = htmlToText(
      stripCdata(
        firstNonEmpty(
          extractField(block, "dc:creator"),
          extractField(block, "author"),
          extractField(block, "name"),
        ),
      ),
    );
    if (!title && !link) continue;
    const text = htmlToText(stripCdata(contentRaw));
    const threadId = link || `sha256-${hashOf(title)}`;
    threads.push(
      threadFrom({
        platform: "rss",
        via: "rss",
        threadId,
        title: title || link,
        author: author || "unknown",
        url: link,
        timestamp: published,
        metrics: { upvotes: 0, comments: 0 },
        posts: [
          {
            postId: `entry-${hashOf(link || title)}`,
            author: author || "unknown",
            text,
            timestamp: isoFrom(published),
            score: 0,
          },
        ],
        ctx,
      }),
    );
  }
  return threads;
}

function hashOf(s) {
  // node:crypto via validate.mjs re-export keeps imports minimal here
  return s ? String(s.length) + "-" + (s.slice(0, 40).replace(/\W+/g, "")) : "empty";
}

export function parse(rawBody, ctx) {
  try {
    return parseFeed(rawBody, ctx);
  } catch {
    return [];
  }
}

export async function collect({ query, limit = 25, state = {} } = {}) {
  const feedUrl = String(query || "").trim();
  if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) {
    throw new Error(
      `rss source needs a feed URL as --query (e.g. --query https://github.blog/feed/); got "${query}"`,
    );
  }
  const res = await fetchJsonOrText(feedUrl);
  const ctx = { url: feedUrl, retrievedAt: res.retrievedAt, sha256: res.sha256, query: feedUrl, limit, state, via: id };
  const threads = parse(res.body, ctx);
  return limit ? threads.slice(0, limit) : threads;
}

export default { id, parse, collect };
