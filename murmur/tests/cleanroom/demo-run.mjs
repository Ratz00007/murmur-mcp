#!/usr/bin/env node
/**
 * tests/cleanroom/demo-run.mjs — headless demo of the full five-stage
 * pipeline ("npm run demo"). No MCP client needed: this is the engine +
 * the deterministic mock brain writing a real report to disk.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const { runPipeline } = await import(path.join(root, "tests", "helpers", "pipeline.mjs"));
const engine = await import(path.join(root, "packages", "engine", "dist", "index.js"));

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-demo-"));
const t0 = Date.now();
const run = await runPipeline(engine, {
  cwd,
  seed: `demo-${new Date().toISOString().slice(0, 10)}`,
  worldName: "acme-pricing-reaction",
  rounds: 5,
  population: 12,
  injectAtRound: 3,
  injectText: "Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30%",
});
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const status = engine.worldStatus(run.storage, run.world);
run.close();

process.stdout.write(`
┌──────────────────────────────────────────────────────────────────────┐
│  Murmur headless demo — full pipeline, mock brain (no LLM needed)    │
└──────────────────────────────────────────────────────────────────────┘
  world          ${run.world.name} (${run.world.slug})
  entities       ${run.entityCount}
  personas       ${status.counts.personas}
  rounds         ${run.world.round}/${run.world.config.rounds} · ${status.counts.posts} posts · ${status.counts.events} events
  duration       ${seconds}s
  report         ${run.reportPath}

  Deterministic: same seed + same submissions replay this world byte-identically.
  With a real coding agent (Claude Code, Codex, OpenCode, …) the same pipeline
  runs through the murmur MCP tools — the agent's LLM is the brain, no API keys.

Report preview
--------------
`);
const md = run.markdown.split("\n").slice(0, 24).join("\n");
process.stdout.write(md + "\n…\n\n");
