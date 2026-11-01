#!/usr/bin/env node
/**
 * murmur public-data collector CLI.
 *
 * Usage:
 *   node tools/collector/cli.mjs --source hn --query 'Docker Hub free team' --out threads.jsonl
 *   node tools/collector/cli.mjs --list
 *
 * Sources: hn, github, lobsters, stackexchange, mastodon, bluesky, discourse,
 * devto, rss, reddit. See README.md for per-source options and limits.
 *
 * Pipeline: collect -> depth cap (20) -> engine-mirroring validation ->
 * --since filter -> dedupe (sha256 + platform/threadId) -> JSONL.
 * Every thread carries provenance {retrievedAt, contentSha256, via}.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  setOffline,
  setRecordDir,
  setRefresh,
  isOffline,
} from "./http.mjs";
import { dedupeThreads, validateAndNormalize } from "./validate.mjs";
import hn from "./sources/hn.mjs";
import github from "./sources/github.mjs";
import lobsters from "./sources/lobsters.mjs";
import stackexchange from "./sources/stackexchange.mjs";
import mastodon from "./sources/mastodon.mjs";
import bluesky from "./sources/bluesky.mjs";
import discourse from "./sources/discourse.mjs";
import devto from "./sources/devto.mjs";
import rss from "./sources/rss.mjs";
import reddit from "./sources/reddit.mjs";

export const SOURCES = {
  hn,
  github,
  lobsters,
  stackexchange,
  mastodon,
  bluesky,
  discourse,
  devto,
  rss,
  reddit,
};

const SOURCE_NOTES = {
  hn: "Algolia search + full comment tree (no auth)",
  github: "REST issue search + comments (optional GITHUB_TOKEN)",
  lobsters: "search.json / newest.json + /s/<id>.json (1 req/s by policy)",
  stackexchange: "Stack Overflow 2.3 search/advanced + answers (optional STACKEXCHANGE_KEY)",
  mastodon: "mastodon.social v2 status search, tag-timeline fallback",
  bluesky: "public AppView searchPosts + getPostThread (no auth)",
  discourse: "any forum: --forum https://meta.discourse.org (search.json + t/<id>.json)",
  devto: "articles listing + comments (no full-text API; local term filter)",
  rss: "feed URL as --query (e.g. https://github.blog/feed/)",
  reddit: "ARCHIVE ONLY via arctic-shift; --query 'r/<sub> <terms>' (never reddit.com)",
};

function usage() {
  return `murmur collector — offline-fixture research tool (never shipped with murmur)

Usage:
  node tools/collector/cli.mjs --source <id> --query '<text>' --out threads.jsonl
  node tools/collector/cli.mjs --source discourse --forum https://meta.discourse.org --query 'pricing'
  node tools/collector/cli.mjs --source rss --query https://github.blog/feed/
  node tools/collector/cli.mjs --list

Options:
  --source <id>    one of: ${Object.keys(SOURCES).join(", ")}
  --query <text>   search query (rss: the feed URL; reddit: 'r/<sub> <terms>')
  --forum <url>    Discourse base URL (required for --source discourse)
  --out <file>     JSONL output path (default: tools/collector/out/threads-<source>.jsonl)
  --limit <n>      max threads per run (default 10)
  --since <date>   drop threads older than YYYY-MM-DD
  --refresh        ignore the 24h on-disk response cache
  --record <dir>   save every raw live response as a cassette under <dir>
  --offline        never touch the network; replay committed fixtures/
  --list           list sources and exit
  --help           show this help`;
}

function fail(message) {
  console.error(`collector: ${message}`);
  process.exit(1);
}

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      query: { type: "string" },
      forum: { type: "string" },
      out: { type: "string" },
      limit: { type: "string" },
      since: { type: "string" },
      refresh: { type: "boolean", default: false },
      record: { type: "string" },
      offline: { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const limit = values.limit ? Number.parseInt(values.limit, 10) : 10;
  if (values.limit && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error(`--limit must be a positive integer, got "${values.limit}"`);
  }
  if (values.since && !/^\d{4}-\d{2}-\d{2}$/.test(values.since)) {
    throw new Error(`--since must be YYYY-MM-DD, got "${values.since}"`);
  }
  return { ...values, limit };
}

export async function run(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (err) {
    fail(err.message);
  }
  if (opts.help) {
    console.log(usage());
    return 0;
  }
  if (opts.list) {
    console.log("Available sources:");
    for (const [id, notes] of Object.entries(SOURCE_NOTES)) {
      console.log(`  ${id.padEnd(14)} ${notes}`);
    }
    return 0;
  }
  if (!opts.source) fail(`--source is required (one of: ${Object.keys(SOURCES).join(", ")}) — or use --list`);
  const source = SOURCES[opts.source];
  if (!source) fail(`unknown source "${opts.source}" — one of: ${Object.keys(SOURCES).join(", ")}`);

  const query = opts.query || "";
  if (!query && opts.source !== "rss") fail("--query is required");
  if (opts.source === "discourse" && !opts.forum) fail("--source discourse requires --forum <base URL>");

  setOffline(opts.offline);
  setRefresh(opts.refresh);
  if (opts.record) {
    if (opts.offline) fail("--record cannot be combined with --offline (nothing is fetched)");
    setRecordDir(path.resolve(opts.record));
  }

  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.resolve("tools/collector/out", `threads-${opts.source}.jsonl`);

  let collected;
  try {
    collected = await source.collect({ query, limit: opts.limit, forum: opts.forum });
  } catch (err) {
    fail(`${opts.source} collect failed: ${err.message}`);
  }

  const reasons = {};
  const bump = (reason) => {
    reasons[reason] = (reasons[reason] || 0) + 1;
  };

  const valid = [];
  for (const raw of collected) {
    const result = validateAndNormalize(raw);
    for (const reason of result.reasons) bump(reason);
    if (!result.ok) continue;
    if (opts.since) {
      const cutoff = Date.parse(`${opts.since}T00:00:00Z`);
      if (Date.parse(result.thread.timestamp) < cutoff) {
        bump("before-since");
        continue;
      }
    }
    valid.push(result.thread);
  }

  const deduped = dedupeThreads(valid);
  for (const d of deduped.dropped) bump(d.reason);
  const threads = deduped.threads;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const jsonl = threads.map((t) => JSON.stringify(t)).join("\n");
  fs.writeFileSync(outPath, threads.length ? `${jsonl}\n` : "", "utf8");

  const posts = threads.reduce((n, t) => n + t.posts.length, 0);
  const summary = {
    source: opts.source,
    query,
    mode: isOffline() ? "offline" : opts.record ? "live+record" : "live",
    collected: collected.length,
    written: threads.length,
    posts,
    reasons,
    out: outPath,
  };
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (isMain) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`collector: unhandled failure: ${err.stack || err.message}`);
      process.exitCode = 1;
    },
  );
}
