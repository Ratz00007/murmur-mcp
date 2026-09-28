/**
 * MurmurBench-0 — Step 2: fetch comments for each selected thread.
 *
 * Comments are written to bench/data/<obs>/comments.json. They are NOT read
 * by the selector, and neither arm ever sees them: they are ground truth
 * only (PROTOCOL.md §6). No objection extraction happens in this file.
 *
 * Usage: node bench/fetch-comments.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchComments } from "./lib/arctic-shift.mjs";
import { sleep } from "./lib/sleep.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const sel = JSON.parse(readFileSync(join(HERE, "data", "selection.json"), "utf8"));

/** §6: depth <= 2 — deeper nesting adds noise relative to cost at N=5. */
const MAX_DEPTH = 2;

for (const obs of sel.selected) {
  const dir = join(HERE, "data", obs.observation_id);
  const outPath = join(dir, "comments.json");
  mkdirSync(dir, { recursive: true });

  if (existsSync(outPath)) {
    const prev = JSON.parse(readFileSync(outPath, "utf8"));
    console.log(`${obs.observation_id}: cached (${prev.comments.length} comments)`);
    continue;
  }

  process.stdout.write(`${obs.observation_id} r/${obs.subreddit} … `);
  const { comments, status, error } = await fetchComments(obs.link_id, { limit: 100 });
  if (status !== 200 && comments.length === 0) {
    console.log(`FETCH FAILED (status ${status}${error ? `, ${error}` : ""})`);
    console.log(JSON.stringify({ observation_id: obs.observation_id, error: `status ${status}`, comments: [] }, null, 2));
    continue;
  }

  // Keep root comments and their direct replies only.
  const kept = comments.filter((c) => (c.depth ?? 0) <= MAX_DEPTH);
  const rows = kept.map((c) => ({
    id: c.id,
    depth: c.depth ?? 0,
    score: c.score ?? 0,
    body: (c.body ?? "").trim(),
  }));
  rows.sort((a, b) => a.id.localeCompare(b.id));

  writeFileSync(outPath, JSON.stringify({ observation_id: obs.observation_id, status, comments: rows }, null, 2));
  console.log(`${rows.length} comments (of ${comments.length} fetched, depth<=${MAX_DEPTH})`);
  await sleep(4000);
}
