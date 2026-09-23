#!/usr/bin/env node
/**
 * tools/scale-benchmark.mjs — measure the host-LLM budget and wall time of a
 * full pipeline run at a given scale, using the deterministic mock brain.
 *
 *   node tools/scale-benchmark.mjs [population] [rounds] [seed]
 *   node tools/scale-benchmark.mjs 48 8            # flagship scale
 *
 * Prints a table you can paste into the README's "Token cost" section and into
 * a gallery entry. The token numbers are chars/4 estimates (the same estimator
 * the server's NFR uses), so they are comparable across scales — but they are
 * ESTIMATES: a real-LLM run's billed tokens will differ by tokenizer and by how
 * verbose the host model is. Label any published table accordingly.
 *
 * Content quality is NOT measured here: the brain is the deterministic mock.
 * See murmur-demo/FLAGSHIP-DEMO.md for the real-LLM flagship protocol.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MURMUR = path.resolve(HERE, "..", "murmur");

const population = Number(process.argv[2] ?? 48);
const rounds = Number(process.argv[3] ?? 8);
const seed = process.argv[4] ?? `scale-${population}x${rounds}`;

const engine = await import(pathToFileURL(path.join(MURMUR, "packages", "engine", "dist", "index.js")).href);
const { runPipeline } = await import(pathToFileURL(path.join(MURMUR, "tests", "helpers", "pipeline.mjs")).href);

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-scale-"));
const t0 = Date.now();
const run = await runPipeline(engine, { cwd, seed, rounds, population });
const seconds = (Date.now() - t0) / 1000;
const b = run.tokenBudget;

const n = (x) => x.toLocaleString("en-US");
process.stdout.write(`\nmurmur scale benchmark — ${population} personas × ${rounds} rounds (seed "${seed}", mock brain)\n`);
process.stdout.write("=".repeat(78) + "\n");
process.stdout.write(`wall time          ${seconds.toFixed(2)}s (including report render, excluding host-LLM latency)\n`);
process.stdout.write(`generation items   ${n(b.generationItems)} (persona-round actions the host LLM must author)\n`);
process.stdout.write(`input  (tasks)     ${n(b.inputTotal)} est. tokens  [ontology ${n(b.ontologyTask)} · personas ${n(b.personasTask)} · sim ${n(b.simTasks)} over ${b.simRounds} rounds · report ${n(b.reportTask)}]\n`);
process.stdout.write(`output (content)   ${n(b.outputTotal)} est. tokens  [generations ${n(b.generations)} · report draft ${n(b.draftTokens)}]\n`);
process.stdout.write(`round trip         ${n(b.inputTotal + b.outputTotal)} est. tokens for one full run\n`);
process.stdout.write(`report size        ${n(b.markdownChars)} chars of markdown\n`);
process.stdout.write("=".repeat(78) + "\n");
process.stdout.write("estimates only (chars/4) — real-LLM billing varies by tokenizer and verbosity.\n\n");

process.stdout.write(
  JSON.stringify({ population, rounds, seed, seconds: Number(seconds.toFixed(2)), ...b }, null, 2) + "\n"
);

run.close();
fs.rmSync(cwd, { recursive: true, force: true });
