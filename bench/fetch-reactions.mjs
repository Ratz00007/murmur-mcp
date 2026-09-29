/**
 * MurmurBench-0 — Step 2: fetch the reaction comments (the GROUND TRUTH source).
 *
 * Protocol §6: depth <= 2, fixed extraction prompt, full hand audit at N=5.
 *
 * The comments are written per observation and are read only by the extraction
 * step. Neither arm ever sees them. Comment bodies are never sent anywhere.
 *
 * Usage: node bench/fetch-reactions.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchComments } from "./lib/arctic-shift.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAIRS = join(HERE, "data-vendor", "pairs.json");
const data = JSON.parse(readFileSync(PAIRS, "utf8"));
const OUT_DIR = join(HERE, "data-vendor", "reactions");
mkdirSync(OUT_DIR, { recursive: true });

/** §6: depth <= 2 — deeper nesting adds signal noise relative to cost at N=5. */
const MAX_DEPTH = 2;

for (const pair of data.pairs) {
  const out = join(OUT_DIR, `${pair.observation_id}.json`);
  if (existsSync(out)) {
    const prev = JSON.parse(readFileSync(out, "utf8"));
    console.log(`${pair.observation_id} ${pair.vendor.padEnd(11)} cached (${prev.comments.length} comments)`);
    continue;
  }
  process.stdout.write(`${pair.observation_id} ${pair.vendor.padEnd(11)} r/${pair.reaction.subreddit.padEnd(14)} … `);
  const { comments, status, error } = await fetchComments(pair.reaction.link_id, { limit: 100 });
  if (status !== 200 || comments.length === 0) {
    console.log(`FAILED (status ${status}${error ? `, ${error}` : ""})`);
    data.dropped.push({ query: "reaction_fetch", id: pair.observation_id, reason: `reaction_unretrievable_${status}` });
    await sleep(3000);
    continue;
  }
  const kept = comments
    .filter((c) => (c.depth ?? 0) <= MAX_DEPTH)
    .map((c) => ({ id: c.id, depth: c.depth ?? 0, score: c.score ?? 0, body: (c.body ?? "").trim() }))
    // Deterministic order so a re-run produces an identical file.
    .sort((a, b) => (a.depth - b.depth) || b.score - a.score || a.id.localeCompare(b.id))
    .filter((c) => c.body.length > 0);
  writeFileSync(out, JSON.stringify({ observation_id: pair.observation_id, vendor: pair.vendor, status, comments: kept }, null, 2));
  console.log(`${kept.length} comments (depth<=${MAX_DEPTH}, of ${comments.length} fetched)`);
  await sleep(3500);
}

console.log(`\n--- reaction comments fetched ---`);
for (const f of ["v2", "v3", "v4", "v7", "v8"]) {
  const p = join(OUT_DIR, `${f}.json`);
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    console.log(`  ${f}  ${j.vendor.padEnd(11)} ${String(j.comments.length).padStart(4)} comments`);
  }
}
