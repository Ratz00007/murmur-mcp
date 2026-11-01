/**
 * One-off fixture curation for tools/collector/fixtures.
 * Run: node curate-fixtures.mjs (from anywhere; paths are absolute).
 *
 * Reads recorded cassettes from tools/collector/.record/<source>/, trims each
 * body (<=3 threads per source, strings cut to 2000 chars, arrays capped,
 * size < 100KB), recomputes sha256 over the trimmed body, and writes
 * fixtures/<source>/<key>.json. Documented in README as a lossy,
 * cassette-only transformation (live outputs keep full bodies).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = "C:/Users/ratin/Desktop/murmur-mcp/tools/collector";
const RECORD = path.join(ROOT, ".record");
const FIXTURES = path.join(ROOT, "fixtures");
const MAX_STR = 2000;
const MAX_BYTES = 100 * 1024;

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function capChildren(node) {
  if (Array.isArray(node)) {
    const arr = node.slice(0, 12).map(capChildren);
    return arr;
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "children" && Array.isArray(v)) out[k] = v.slice(0, 12).map(capChildren);
      else out[k] = capChildren(v);
    }
    return out;
  }
  if (typeof node === "string" && node.length > MAX_STR) return node.slice(0, MAX_STR);
  return node;
}

function truncateStrings(node) {
  if (Array.isArray(node)) return node.map(truncateStrings);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = truncateStrings(v);
    return out;
  }
  if (typeof node === "string" && node.length > MAX_STR) return node.slice(0, MAX_STR);
  return node;
}

function trimJsonBody(body, { listPaths = [], listCap = 3, hnTree = false } = {}) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return body; // non-JSON: return untouched
  }
  for (const lp of listPaths) {
    const parts = lp.split(".");
    let cur = data;
    for (let i = 0; i < parts.length - 1 && cur; i++) cur = cur[parts[i]];
    const key = parts[parts.length - 1];
    if (cur && Array.isArray(cur[key])) cur[key] = cur[key].slice(0, listCap);
  }
  data = truncateStrings(data);
  return JSON.stringify(hnTree ? capChildren(data) : data);
}

function trimRss(body) {
  // keep channel header + first 3 <item> blocks + closing tags; cap CDATA
  // post text at MAX_STR chars (cassette-only transformation)
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/g;
  let m;
  let first = body.length;
  let last = 0;
  while ((m = re.exec(body))) {
    items.push(m[0]);
    first = Math.min(first, m.index);
    last = re.lastIndex;
  }
  let kept = items.length > 3 ? items.slice(0, 3) : items;
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  kept = kept.map((item) =>
    item.replace(cdataRe, (_, text) =>
      text.length > MAX_STR ? `<![CDATA[${text.slice(0, MAX_STR)}]]>` : `<![CDATA[${text}]]>`,
    ),
  );
  if (items.length === 0) return body;
  if (items.length <= 3 && kept.every((k, i) => k === items[i])) return body; // nothing trimmed
  return body.slice(0, first) + kept.join("\n") + body.slice(last);
}

const PLAN = {
  hn: {
    listCap: 5,
    listPaths: (url) => (url.includes("/search?") ? ["hits"] : []),
    hnTree: true,
    // keep only cassettes that complete the first 3 threads
    keepThreads: 3,
  },
  github: { listCap: 3, listPaths: (url) => (url.includes("/search/issues") ? ["items"] : []), commentsCap: 30 },
  stackexchange: { listCap: 4, listPaths: (url) => (url.includes("/search/advanced") ? ["items"] : url.includes("/answers") ? ["items"] : []) },
  mastodon: { listCap: 4, listPaths: (url) => (url.includes("/timelines/tag/") ? [] : url.includes("/search?") ? ["statuses"] : []), descendantsCap: 30 },
  bluesky: { listCap: 3, listPaths: (url) => (url.includes("searchPosts") ? ["posts"] : []), repliesCap: 12 },
  devto: { listCap: 4, listPaths: (url) => (url.includes("/articles") ? [] : []), commentsCap: 20 },
  reddit: { listCap: 3, listPaths: (url) => (url.includes("/posts/search") ? ["data"] : url.includes("/comments/search") ? ["data"] : []) },
  rss: { rss: true },
};

function trimBlueskyThread(body) {
  try {
    const data = JSON.parse(body);
    const t = data?.thread;
    const walk = (node, depth) => {
      if (!node || depth > 5) return null;
      if (node.replies) node.replies = (node.replies || []).slice(0, 8).map((r) => walk(r, depth + 1)).filter(Boolean);
      return node;
    };
    if (t) walk(t, 0);
    return JSON.stringify(data);
  } catch {
    return body;
  }
}

function capDescendants(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data?.descendants)) data.descendants = data.descendants.slice(0, 30);
    return JSON.stringify(data);
  } catch {
    return body;
  }
}

function capCommentsArray(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) return JSON.stringify(data.slice(0, 20));
    return JSON.stringify(data);
  } catch {
    return body;
  }
}

function capCommentsArrayWith(body, cap) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) {
      return JSON.stringify(truncateStrings(data.slice(0, cap)));
    }
    return body;
  } catch {
    return body;
  }
}

function capRedditData(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data?.data)) data.data = data.data.slice(0, 30);
    return JSON.stringify(data);
  } catch {
    return body;
  }
}

function trimBody(source, url, body) {
  const plan = PLAN[source] || {};
  let out = body;
  if (plan.rss) return trimRss(out);
  if (source === "mastodon" && url.includes("/context")) out = capDescendants(out);
  if (source === "bluesky" && url.includes("getPostThread")) out = trimBlueskyThread(out);
  if ((source === "github" || source === "devto") && url.includes("/comments")) out = capCommentsArray(out);
  if (source === "reddit" && url.includes("/comments/search")) out = capRedditData(out);
  const listPaths = plan.listPaths ? plan.listPaths(url) : [];
  if (source === "mastodon" && url.includes("/timelines/tag/")) {
    try {
      const arr = JSON.parse(out);
      out = JSON.stringify(arr.slice(0, 4));
    } catch { /* keep */ }
  }
  if (source === "devto" && url.includes("/articles")) {
    try {
      const arr = JSON.parse(out);
      out = JSON.stringify(arr.slice(0, 4));
    } catch { /* keep */ }
  }
  out = trimJsonBody(out, { listPaths, listCap: plan.listCap ?? 3, hnTree: plan.hnTree });
  return out;
}

const sources = fs.readdirSync(RECORD).filter((d) => fs.statSync(path.join(RECORD, d)).isDirectory() && PLAN[d]);
const report = [];
const skipped = [];
for (const source of sources) {
  const dir = path.join(RECORD, source);
  const outDir = path.join(FIXTURES, source);
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const entries = files
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const e of entries) {
    if (e.status !== 200) continue;
    let body = trimBody(source, e.url, e.body);
    // progressive comment-array shrink for pathological bodies; never commit
    // broken JSON — skip a cassette that cannot fit
    for (const cap of [20, 10, 6, 3, 2]) {
      if (Buffer.byteLength(body, "utf8") <= MAX_BYTES) break;
      if (/\/comments/.test(e.url)) body = capCommentsArrayWith(e.body, cap);
    }
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
      skipped.push(`${source}: ${e.url} (${Buffer.byteLength(body, "utf8")} bytes) — skipped`);
      continue;
    }
    const out = {
      url: e.url,
      method: e.method || "GET",
      status: e.status,
      retrievedAt: e.retrievedAt,
      sha256: sha256(body),
      seq: e.seq,
      body,
    };
    const key = crypto.createHash("sha256").update(`${out.method}${out.url}`).digest("hex");
    const file = path.join(outDir, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(out), "utf8");
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    report.push(`${source}: ${path.basename(file)} ${kb}KB ${e.url.slice(0, 90)}`);
  }
}
console.log(report.join("\n"));
if (skipped.length) console.log("\nSKIPPED:\n" + skipped.join("\n"));
console.log(`\nfiles: ${report.length}, skipped: ${skipped.length}`);
