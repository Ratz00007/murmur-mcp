#!/usr/bin/env node
/**
 * tools/host-llm-run/check-gallery.mjs — CI gate for the published gallery.
 *
 * WHY THIS EXISTS: a stale copy of report-1.md once shipped in the gallery
 * citing po_20, a post id that did not exist in the run that produced it. The
 * engine's own citation-integrity test could not catch it: that test validates
 * a freshly generated report, while the gallery holds a committed *copy* that
 * can silently drift. This gate closes that gap.
 *
 * It is deliberately SELF-CONTAINED: it needs only files that are committed to
 * git (the gallery entry + its brain), because the run database lives in the
 * gitignored .murmur/ directory and is absent in CI. When a local database does
 * happen to be present, the gate additionally checks every cited id against it.
 *
 * The expected post count is derived from the brain: the engine mints one post
 * per submitted action, so the number of actions across rounds/*.json is the
 * number of posts, and post ids run po_1..po_N.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const entry = path.join(repo, "gallery", "llm-authored-run-12x4");
const brain = path.join(entry, "brain");

let failures = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

// ---- 1. required files present and non-trivial
for (const f of ["report-1.md", "report-1.html", "README.md", "graph.mmd"]) {
  const p = path.join(entry, f);
  if (!fs.existsSync(p)) { fail(`${f} missing from the gallery entry`); continue; }
  const n = fs.statSync(p).size;
  if (n < 500) fail(`${f} is suspiciously small (${n}b)`);
  else ok(`${f} present (${n}b)`);
}
if (failures) { console.error("\nGALLERY GATE: FAILED"); process.exit(1); }

// ---- 2. derive the expected post count from the committed brain
// The engine mints one post per *post-producing* action. A `like` is an
// engagement, not a post, so it must not be counted here — getting this wrong
// would overstate the run's size and mask a real citation error.
// Verified against sim/ingest.ts: post/reply/quote/repost/comment all reach
// makePost() and mint a row; like/upvote/downvote are engagement-only and mint
// nothing. Getting this wrong would over- or under-count the run and mask a
// real citation error.
const POSTING = new Set(["post", "reply", "quote", "repost", "comment"]);
const brainFiles = fs.readdirSync(brain).filter((f) => /^round-\d+\.json$/.test(f)).sort();
if (!brainFiles.length) { fail("no round-*.json in brain/ — cannot verify"); process.exit(1); }
let expected = 0;
for (const f of brainFiles) {
  const gens = JSON.parse(fs.readFileSync(path.join(brain, f), "utf8"));
  const arr = Array.isArray(gens) ? gens : (gens.generations ?? gens.items ?? []);
  const n = arr.reduce(
    (a, g) => a + (Array.isArray(g.actions) ? g.actions.filter((x) => POSTING.has(x.type)).length : 0),
    0,
  );
  if (n === 0) fail(`${f} contributes no posts`);
  expected += n;
}
ok(`brain yields ${expected} posts across ${brainFiles.length} rounds (${brainFiles.join(", ")})`);

// ---- 3. every cited post id is inside the run's real id space
const md = fs.readFileSync(path.join(entry, "report-1.md"), "utf8");
const cited = [...new Set([...md.matchAll(/po_(\d+)/g)].map((m) => `po_${m[1]}`))];
const nums = cited.map((c) => Number(c.slice(3)));
const dangling = cited.filter((_, i) => nums[i] < 1 || nums[i] > expected);
if (dangling.length) fail(`citations outside the run's id space po_1..po_${expected}: ${dangling.join(", ")}`);
else ok(`all ${cited.length} cited ids fall inside po_1..po_${expected}`);

// ---- 4. the report's own headline post count agrees with the brain
// The At a Glance block is a two-row table: a header row naming the columns,
// then a value row. Read the cell directly beneath the "Simulated posts" header.
const lines = md.split(/\r?\n/);
const hIdx = lines.findIndex((l) => /^\|\s*Simulated posts\s*\|/.test(l));
if (hIdx < 0) fail('could not find the "Simulated posts" column in the At a Glance table');
else {
  // The value row is the first following line that is a data row, not the
  // |---|---| separator. Reading hIdx+1 blindly lands on the separator.
  const valueRow = lines.slice(hIdx + 1).find((l) => /^\|\s*\d+\s*\|/.test(l));
  if (!valueRow) fail("could not read the At a Glance value row (no numeric data row found)");
  else {
    const claimed = valueRow.match(/^\|\s*(\d+)\s*\|/)[1];
    if (Number(claimed) !== expected) fail(`report claims ${claimed} posts, brain produces ${expected}`);
    else ok(`report's stated post count (${expected}) matches the brain`);
  }
}

// ---- 5. if a local database exists, verify against it too
const dbPath = path.join(repo, ".murmur", "murmur.db");
if (fs.existsSync(dbPath)) {
  const { DatabaseSync } = await import("node:sqlite");
  const have = new Set(new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT id FROM posts").all().map((r) => r.id));
  const missing = cited.filter((c) => !have.has(c));
  if (missing.length) fail(`ids cited but absent from the local database: ${missing.join(", ")}`);
  else ok(`cross-checked against the local database (${have.size} posts): all cited ids resolve`);
} else {
  console.log("  skip  no local database (.murmur/ is gitignored) — verified from the brain alone");
}

console.log(failures ? `\nGALLERY GATE: FAILED (${failures})` : "\nGALLERY GATE: GREEN");
process.exit(failures ? 1 : 0);

