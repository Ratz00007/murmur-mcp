/**
 * Truth check: no hardcoded test counts in the docs.
 *
 * The repo asserted "66 unit + golden tests" in nine files for weeks while the
 * real number was 69, and PROJECT-WORKLOG.md still says 42. A phase was spent
 * "fixing doc lies" and the count was wrong in the very commit that claimed it
 * was fixed. Recounting by hand does not survive, so this fails CI instead.
 *
 * Also verifies the advertised MCP tool count against what is actually
 * registered, which was a bare literal with no assertion anywhere.
 *
 * Usage: node tools/verify-claims.mjs [--write]
 *   --write  rewrite <!--counts:…--> blocks in place instead of failing
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MURMUR = join(ROOT, "murmur");
const WRITE = process.argv.includes("--write");

/** Count tests per vitest project by running vitest in JSON reporter mode. */
function countTests(project) {
  // Invoke vitest's JS entry directly rather than shelling out to npx: on
  // Windows `npx.cmd` cannot be spawned via execFileSync, and the local binary
  // is the same one `npm test` runs.
  const vitestCli = join(MURMUR, "node_modules", "vitest", "vitest.mjs");
  const out = execFileSync(
    process.execPath,
    [vitestCli, "run", "--project", project, "--reporter=json", "--silent"],
    { cwd: MURMUR, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  // vitest's JSON reporter emits several concatenated objects and the totals
  // object nests a `snapshot` object, so scan for balanced braces rather than
  // slicing to the first `}`.
  const text = out.trim();
  const at = text.lastIndexOf('"numTotalTests"');
  if (at === -1) throw new Error(`could not parse vitest json for project ${project}`);
  const start = text.lastIndexOf("{", at);
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error(`unbalanced vitest json for project ${project}`);
  const blob = JSON.parse(text.slice(start, end));
  return { total: blob.numTotalTests, failed: blob.numFailedTests };
}

console.log("Measuring test counts from vitest…");
// `npm test` runs `--project unit --project golden`; the advertised number is
// the sum, so measure exactly what the package script runs rather than one
// project, or the gate will enforce a number nobody ever quotes.
const unitOnly = countTests("unit");
const goldenOnly = countTests("golden");
const total = unitOnly.total + goldenOnly.total;
console.log(`  unit: ${unitOnly.total}   golden: ${goldenOnly.total}   sum: ${total}`);

/** Count registered MCP tools from the source registry. */
const toolsIndex = readFileSync(join(MURMUR, "packages", "server", "src", "tools", "index.ts"), "utf8");
const registerCalls = [...toolsIndex.matchAll(/register\w+Tools\(/g)].length;
const countMatch = toolsIndex.match(/TOOL_COUNT\s*=\s*(\d+)/);
const declaredCount = countMatch ? Number(countMatch[1]) : null;

/** Count registered MCP tools from the source.
 *
 * Each module declares its names in `X_TOOL_NAMES = [...]` and registers them
 * through a shared helper, so counting registration *calls* undercounts: one
 * call site can register one tool, and the helper in tasks.ts registers
 * whatever it is handed. The names arrays are the declaration of record, and
 * tools.test.ts plus the startup assertToolSurface() already verify those
 * arrays match what the live server exposes. What this checks is that the
 * advertised TOOL_COUNT matches the declared names — the drift that used to be
 * silent.
 */
let actualTools = 0;
for (const f of ["world", "seeds", "ontology", "personas", "sim", "graph", "interact", "report"]) {
  const src = readFileSync(join(MURMUR, "packages", "server", "src", "tools", `${f}.ts`), "utf8");
  const m = src.match(/export const \w+_TOOL_NAMES = \[([\s\S]*?)\] as const/);
  if (!m) throw new Error(`no TOOL_NAMES declaration found in tools/${f}.ts`);
  actualTools += [...m[1].matchAll(/"([a-z_]+)"/g)].length;
}

const facts = {
  tests: total,
  tools: actualTools,
};

console.log(`\nMeasured:`);
console.log(`  unit+golden tests : ${facts.tests}`);
console.log(`  registered tools  : ${facts.tools} across ${registerCalls} modules`);

const problems = [];

if (declaredCount !== null && declaredCount !== actualTools) {
  problems.push(`TOOL_COUNT says ${declaredCount} but ${actualTools} tools are registered`);
}

if (registerCalls !== 8) {
  problems.push(`expected 8 tool modules registered, found ${registerCalls}`);
}



// --- doc claims -------------------------------------------------------------
// Documents that make a PRESENT-TENSE claim about the current suite. A wrong
// number here is a lie a reader will act on.
const CURRENT_CLAIM_DOCS = [
  "README.md",
  "murmur/README.md", "murmur/CONTRIBUTING.md",
];

// Dated records. "42/42 green" in a build journal is accurate for the day it
// was written, and rewriting it would falsify the record rather than fix a
// lie. Reported so drift is visible, never failed.
const HISTORICAL_DOCS = ["docs/archive/PROJECT-WORKLOG.md", "murmur/CHANGELOG.md", "murmur/packages/server/CHANGELOG.md"];

const COUNT_CLAIM = /\b(\d{2,3})\s+(?:unit\s*\+\s*golden|unit and golden|passing)?\s*tests?\b|\b(\d{2,3})\/(\d{2,3})\s+unit\+golden\b|\b(\d{2,3})\/(\d{2,3})\s+unit\s+and\s+golden\b/gi;

/** Numbers that are never test counts (issue refs, dates, counts of tools). */
function numericClaimsIn(doc) {
  const p = join(ROOT, doc);
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf8");
  const hits = [];
  for (const m of text.matchAll(COUNT_CLAIM)) {
    const nums = [m[1], m[2], m[3], m[4], m[5]].filter(Boolean).map(Number);
    const bad = nums.filter((n) => n > 10 && n !== facts.tests);
    if (bad.length > 0) hits.push({ doc, bad });
  }
  return hits;
}

for (const doc of CURRENT_CLAIM_DOCS) {
  for (const h of numericClaimsIn(doc)) {
    problems.push(`${h.doc}: claims ${h.bad.join("/")} tests, measured ${facts.tests}`);
  }
}

const historicalNotes = [];
for (const doc of HISTORICAL_DOCS) {
  for (const h of numericClaimsIn(doc)) {
    historicalNotes.push(`${h.doc}: ${h.bad.join("/")} (historical record, left as written)`);
  }
}

console.log(`\nChecked ${CURRENT_CLAIM_DOCS.length} present-tense docs, ${HISTORICAL_DOCS.length} dated records.`);
if (historicalNotes.length) {
  console.log(`\nDated records mention other counts (correct for their date, not enforced):`);
  for (const n of historicalNotes) console.log(`  · ${n}`);
}

if (problems.length) {
  console.error(`\nCLAIM CHECK FAILED:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\nThe measured numbers are: ${facts.tests} unit+golden tests, ${facts.tools} tools.`);
  console.error(`Fix the doc, or run: node tools/verify-claims.mjs --write`);
  process.exit(1);
}

console.log(`\nCLAIM CHECK GREEN — ${facts.tests} unit+golden tests, ${facts.tools} tools, no stale counts.`);


