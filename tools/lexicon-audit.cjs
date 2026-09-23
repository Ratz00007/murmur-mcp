/** Audit lexicon coverage of the mock-brain voice templates (analysis only). */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "murmur"); // tools/ sits next to murmur/ in the bundle
const src = readFileSync(path.join(root, "tests/helpers/voices.mjs"), "utf8");
const { scoreSentiment } = require(path.join(root, "packages/engine/dist/index.js"));

const strs = [...src.matchAll(/"([^"]{25,})"/g)].map((m) => m[1]);
const text = strs
  .join(" ")
  .toLowerCase()
  .replace(/[^a-z0-9' -]+/g, " ")
  .split(/\s+/)
  .filter((w) => w.length > 3);
const freq = {};
for (const w of text) freq[w] = (freq[w] || 0) + 1;

const scored = Object.entries(freq).filter(([w]) => Math.abs(scoreSentiment(w).score) > 0);
console.log("COVERED", scored.length, ":", scored.map(([w]) => w).sort().join(", "));

const uncovered = Object.entries(freq)
  .filter(([w, n]) => n >= 4 && Math.abs(scoreSentiment(w).score) === 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 90);
console.log("\nUNCOVERED freq>=4:", uncovered.map(([w, n]) => w + "(" + n + ")").join(" "));

// multi-word phrases worth adding
const joined = strs.join(" ").toLowerCase();
for (const p of ["no notes", "just works", "worth it", "lock-in", "cash grab", "rug pull", "deal breaker", "red flag", "rip off", "data loss", "tone deaf", "out of touch", "pleasantly surprised", "bait and switch", "never crashes", "no notes taken"]) {
  const n = joined.split(p).length - 1;
  if (n > 0) console.log(`phrase "${p}": ${n}x`);
}
