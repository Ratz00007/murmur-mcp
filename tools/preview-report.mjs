/** Quality preview: run the full pipeline with the new brain + report v2 and print the report. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const MURMUR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "murmur");
const engine = await import(pathToFileURL(path.join(MURMUR, "packages/engine/dist/index.js")).href);
const { runPipeline } = await import(pathToFileURL(path.join(MURMUR, "tests/helpers/pipeline.mjs")).href);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-preview-"));
const run = await runPipeline(engine, { cwd: dir, seed: "acme-demo-2026", rounds: 5, population: 12, injectAtRound: 3, injectText: "Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30%" });
console.log("=== POST SAMPLE (first 12) ===");
for (const p of run.storage.listPosts(run.worldId, {}).slice(0, 12)) {
  console.log(`  [${p.platform}/${p.kind} r${p.round}] ${p.id}: ${p.body.slice(0, 130)}`);
}
console.log(`\n=== REPORT (${run.markdown.length} bytes) ===\n`);
console.log(run.markdown);
run.close();
fs.rmSync(dir, { recursive: true, force: true });
