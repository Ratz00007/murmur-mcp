/**
 * Trim collector JSONL outputs for committing.
 *
 * Live collector outputs keep full fidelity; the committed copies under
 * tools/collector/out/ are size-capped for the repository:
 *   - keep at most --max-threads threads (default 5)
 *   - truncate every string field over MAX_STR characters (default 2000)
 *   - arrays capped at 12 children per nesting level
 * provenance.contentSha256 refers to the RAW RESPONSE the thread was parsed
 * from and is untouched by thread-body trimming — it still verifies against
 * the recorded cassette, not against the trimmed copy.
 *
 * Usage: node tools/collector/trim-out.mjs <in.jsonl> <out.jsonl> [--max-threads N]
 */
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_STR = 2000;
const MAX_ARR = 12;

function capStrings(node, depth = 0) {
  if (Array.isArray(node)) {
    return node.slice(0, depth > 0 ? MAX_ARR : node.length).map((v) => capStrings(v, depth + 1));
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = capStrings(v, depth + 1);
    return out;
  }
  if (typeof node === "string" && node.length > MAX_STR) {
    return `${node.slice(0, MAX_STR)}… [trimmed for repository size; raw body in the recorded cassette]`;
  }
  return node;
}

const args = process.argv.slice(2).filter((a) => a !== "--max-threads");
const maxThreadsIdx = process.argv.indexOf("--max-threads");
const maxThreads = maxThreadsIdx !== -1 ? Number(process.argv[maxThreadsIdx + 1]) || 5 : 5;
const [inPath, outPath] = args;
if (!inPath || !outPath) {
  console.error("usage: node trim-out.mjs <in.jsonl> <out.jsonl> [--max-threads N]");
  process.exit(1);
}
const lines = fs.readFileSync(inPath, "utf8").split("\n").filter(Boolean).slice(0, maxThreads);
const threads = lines.map((l) => capStrings(JSON.parse(l)));
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, threads.map((t) => JSON.stringify(t)).join("\n") + (threads.length ? "\n" : ""), "utf8");
console.log(`${path.basename(inPath)}: ${lines.length} threads -> ${outPath} (${Math.round(fs.statSync(outPath).size / 1024)}KB)`);
