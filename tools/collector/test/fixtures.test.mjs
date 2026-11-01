/**
 * Offline fixture-replay tests: every committed cassette under fixtures/ is
 * parsed by its source module and every emitted thread must pass the
 * collector validator (which mirrors the engine's validateDiscourseThread).
 *
 * Two passes over each source's cassettes with shared state make the pairing
 * order-independent: listing responses stash candidates, detail responses
 * emit threads once their counterpart has been stashed (whichever came
 * first on disk).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { validateThread } from "../validate.mjs";
import hn from "../sources/hn.mjs";
import github from "../sources/github.mjs";
import lobsters from "../sources/lobsters.mjs";
import stackexchange from "../sources/stackexchange.mjs";
import mastodon from "../sources/mastodon.mjs";
import bluesky from "../sources/bluesky.mjs";
import discourse from "../sources/discourse.mjs";
import devto from "../sources/devto.mjs";
import rss from "../sources/rss.mjs";
import reddit from "../sources/reddit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "..", "fixtures");

const SOURCES = {
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

const EXPECTED_PLATFORM = {
  hn: "hackernews",
  github: "github",
  lobsters: "lobsters",
  stackexchange: "stackexchange",
  mastodon: "mastodon",
  bluesky: "bluesky",
  discourse: "discourse",
  devto: "devto",
  rss: "rss",
  reddit: "reddit",
};

function cassettesFor(source) {
  const dir = path.join(FIXTURES, source);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

test("every committed cassette parses offline into valid threads", () => {
  const dirs = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES) : [];
  assert.ok(dirs.length >= 5, `expected fixtures for at least 5 sources, got ${dirs.length}`);
  for (const source of dirs) {
    const mod = SOURCES[source];
    assert.ok(mod, `fixtures exist for unknown source "${source}"`);
    const cassettes = cassettesFor(source);
    assert.ok(cassettes.length > 0, `source ${source} has no cassettes`);
    const state = {};
    const threads = [];
    const forum = source === "discourse" ? "https://meta.discourse.org" : undefined;
    // Two passes make listing/detail pairing independent of file order.
    for (let pass = 0; pass < 2; pass++) {
      for (const cassette of cassettes) {
        const ctx = {
          url: cassette.url,
          retrievedAt: cassette.retrievedAt,
          sha256: cassette.sha256,
          query: "",
          limit: 10,
          forum,
          state,
          via: source,
        };
        threads.push(...mod.parse(cassette.body, ctx));
      }
    }
    assert.ok(
      threads.length > 0,
      `source ${source}: ${cassettes.length} cassettes produced 0 threads`,
    );
    for (const t of threads) {
      const result = validateThread(t);
      assert.deepEqual(
        result.reasons,
        [],
        `source ${source} thread ${t.threadId} failed validation: ${result.reasons.join("; ")}`,
      );
      assert.equal(t.platform, EXPECTED_PLATFORM[source]);
      assert.equal(t.provenance.via, source);
      assert.ok(!Number.isNaN(Date.parse(t.provenance.retrievedAt)));
    }
  }
});

test("committed JSONL outputs validate against the same rules", () => {
  const outDir = path.resolve(HERE, "..", "out");
  const jsonlFiles = [];
  const stack = [outDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name.endsWith(".jsonl")) jsonlFiles.push(p);
    }
  }
  assert.ok(jsonlFiles.length >= 5, `expected >=5 committed JSONL outputs, got ${jsonlFiles.length}`);
  let checked = 0;
  for (const file of jsonlFiles) {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const thread = JSON.parse(line);
      const result = validateThread(thread);
      assert.deepEqual(
        result.reasons,
        [],
        `${path.basename(file)} line ${checked}: ${result.reasons.join("; ")}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `expected >=10 committed threads, checked ${checked}`);
});
