/**
 * CLI smoke tests, fully offline: spawn cli.mjs as a subprocess (its error
 * paths call process.exit) against the committed cassettes under fixtures/.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "tools", "collector", "cli.mjs");

function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function tmpOut(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collector-cli-")), name);
}

test("--list prints the source catalog", () => {
  const res = cli(["--list"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Available sources/);
  for (const id of ["hn", "github", "lobsters", "stackexchange", "mastodon", "bluesky", "discourse", "devto", "rss", "reddit"]) {
    assert.match(res.stdout, new RegExp(`\\b${id}\\b`), `source ${id} listed`);
  }
});

test("offline replay of the recorded HN query end to end", () => {
  const out = tmpOut("hn.jsonl");
  const res = cli(["--source", "hn", "--query", "Docker Hub free team", "--limit", "5", "--offline", "--out", out]);
  assert.equal(res.status, 0, res.stderr);
  const summary = JSON.parse(res.stdout);
  assert.equal(summary.mode, "offline");
  assert.ok(summary.written >= 1, `expected threads, got ${summary.written}`);
  assert.ok(summary.posts >= summary.written);
  const lines = fs.readFileSync(out, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, summary.written);
  for (const line of lines) {
    const thread = JSON.parse(line);
    assert.equal(thread.platform, "hackernews");
    assert.equal(thread.provenance.via, "hn");
    assert.match(thread.provenance.contentSha256, /^[0-9a-f]{64}$/);
    assert.ok(thread.posts.length >= 1);
  }
});

test("offline replay of the recorded RSS feed end to end", () => {
  const out = tmpOut("rss.jsonl");
  const res = cli(["--source", "rss", "--query", "https://github.blog/feed/", "--offline", "--out", out]);
  assert.equal(res.status, 0, res.stderr);
  const summary = JSON.parse(res.stdout);
  assert.ok(summary.written >= 1, `expected feed entries, got ${summary.written}`);
  const first = JSON.parse(fs.readFileSync(out, "utf8").split("\n").filter(Boolean)[0]);
  assert.equal(first.platform, "rss");
  assert.ok(first.title.length > 0);
});

test("unknown sources and missing queries fail with usage guidance", () => {
  const badSource = cli(["--source", "nope", "--query", "x", "--offline"]);
  assert.equal(badSource.status, 1);
  assert.match(badSource.stderr, /unknown source/);

  const noQuery = cli(["--source", "hn", "--offline"]);
  assert.equal(noQuery.status, 1);
  assert.match(noQuery.stderr, /--query is required/);

  const noForum = cli(["--source", "discourse", "--query", "x", "--offline"]);
  assert.equal(noForum.status, 1);
  assert.match(noForum.stderr, /--forum/);
});

test("offline mode fails loudly when a cassette is missing", () => {
  const res = cli(["--source", "hn", "--query", "a query nobody ever recorded", "--limit", "1", "--offline"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no committed cassette/);
  assert.match(res.stderr, /--record/);
});

test("record mode cannot be combined with offline mode", () => {
  const res = cli(["--source", "hn", "--query", "x", "--offline", "--record", tmpOut("rec")]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--record cannot be combined with --offline/);
});
