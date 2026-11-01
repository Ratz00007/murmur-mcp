/**
 * r2 artifact fixup v3 — apply the post-run verification decisions:
 *   1. delete the dropped CockroachDB pair's artifact files (h10),
 *   2. rename Heroku's artifacts h11 -> h10 (renumbering after the drop).
 * The CockroachDB pair remains auditable in rejections-r2.json
 * (announcement_page_postdates_reaction_same_url) and in
 * bench/data-hn/pairs-r2-pass2c.json (the run's original output).
 * Usage: node bench/_fix-artifacts-r2.mjs
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "data-hn");
const ANN = join(OUT, "announcements");
const REACT = join(OUT, "reactions");

// Sanity: confirm the merged output really dropped CockroachDB and kept Heroku.
const merged = JSON.parse(readFileSync(join(OUT, "pairs-r2.json"), "utf8"));
const vendors = merged.pairs.map((p) => p.vendor);
if (vendors.includes("CockroachDB")) throw new Error("CockroachDB still in merged pairs; run merge-r2.mjs with the drop first");
if (!vendors.includes("Heroku")) throw new Error("Heroku missing from merged pairs");

for (const f of [join(ANN, "h10.txt"), join(REACT, "h10.json")]) {
  if (existsSync(f)) { unlinkSync(f); console.log(`deleted ${f}`); }
}
for (const [dir, ext] of [[ANN, "txt"], [REACT, "json"]]) {
  const src = join(dir, `h11.${ext}`);
  const dst = join(dir, `h10.${ext}`);
  if (existsSync(src)) { renameSync(src, dst); console.log(`renamed ${src} -> ${dst}`); }
}
console.log("fixup v3 done");
