#!/usr/bin/env node
/**
 * tools/host-llm-run/run.mjs — a *real* host-LLM run of the full pipeline.
 *
 * WHY: the shipped demo uses the deterministic mock brain (schema-valid content
 * from archetype voice templates). That proves the plumbing, never the product.
 * This driver runs the SAME engine, SAME seed corpus and SAME validators, but
 * the "host LLM" is a real language model: the operator authors content into
 * brain/ at each step.
 *
 *   node run.mjs init        # world + authored ontology/personas -> dumps round 1
 *   node run.mjs submit <n>  # ingest authored round n -> dumps round n+1 (or report)
 *   node run.mjs report      # validate + store + render authored report (md + html)
 *
 * This is the exact MCP tool sequence driven headlessly. No engine code is
 * modified and no validation is bypassed: content that violates the schema is
 * REJECTED by the real validator, as it would be for Claude Code / Codex.
 * This is NOT a client-IDE session; the gallery labels it as an LLM-authored run.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "murmur");
const brainDir = path.join(here, "brain");
const dumpDir = path.join(here, "dump");
// Windows ESM requires an absolute path be a file:// URL for dynamic import.
const engine = await import(url.pathToFileURL(path.join(root, "packages", "engine", "dist", "index.js")).href);

const RUN_NAME = process.env.MURMUR_RUN_NAME ?? "acme-pricing-reaction";
const SEED = process.env.MURMUR_SEED ?? "host-llm-flagship-01";
const ROUNDS = Number(process.env.MURMUR_ROUNDS ?? 4);
const POP = Number(process.env.MURMUR_POP ?? 12);
const WORKSPACE = process.env.MURMUR_WORKSPACE ?? path.join(here, "workspace");
const STATE = path.join(here, "state.json");

const load = (f) => JSON.parse(fs.readFileSync(path.join(brainDir, f), "utf8"));
const loadState = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
const dump = (name, value) => {
  fs.mkdirSync(dumpDir, { recursive: true });
  fs.writeFileSync(path.join(dumpDir, name), JSON.stringify(value, null, 2));
  return path.join(dumpDir, name);
};
function open() {
  const ws = new engine.Workspace(WORKSPACE);
  ws.ensure();
  const storage = new engine.Storage(engine.openDatabase(ws.dbPath));
  return { ws, storage };
}

/** Compact view of a sim task so the host LLM can author without wading through JSON. */
function briefSimTask(task) {
  return {
    round: task.round,
    taskId: task.id,
    personas: task.items.map((it) => {
      const d = it.payload;
      return {
        personaId: d.persona.id,
        handle: d.persona.handle,
        archetype: d.persona.archetype,
        platform: d.persona.platform,
        stances: Object.fromEntries(d.persona.stances),
        memory: d.memory?.recent?.slice(-3) ?? [],
        feed: d.feed.map((f) => ({ id: f.id, by: f.by, plat: f.plat, kind: f.kind, body: (f.title ? f.title + " — " : "") + f.body, engagement: f.engagement })),
        allowedActions: d.allowedActions,
        charLimits: d.rules?.charLimits,
      };
    }),
  };
}

const mode = process.argv[2] ?? "init";

// ---------------------------------------------------------------- init
if (mode === "init") {
  if (fs.existsSync(STATE)) {
    console.error("state.json exists — already initialised. Delete state.json + workspace/ to restart.");
    process.exit(1);
  }
  const { ws, storage } = open();
  const world = storage.createWorld({ name: RUN_NAME, seed: SEED });
  ws.ensureWorldDir(world.slug);

  const seedText = fs.readFileSync(path.join(brainDir, "seed.md"), "utf8");
  storage.addSeed(world.id, { kind: "text", title: "Acme Cloud pricing change brief", ref: "brief.md", text: seedText, digest: engine.makeDigest(seedText) });
  storage.setStage(world.id, "seeded");

  // --- ontology: authored by the host LLM, checked by the real validator
  const oTask = engine.buildOntologyTask(storage, world);
  const oRes = engine.applyOntology(storage, world, oTask.id, load("01-ontology.json"));
  if (oRes.rejected.length) {
    console.error("ONTOLOGY REJECTED by real validator:");
    console.error(JSON.stringify(oRes.rejected.slice(0, 8), null, 2));
    process.exit(1);
  }
  engine.buildGraph(storage, world);
  ws.writeAtomic(ws.graphPath(world.slug), engine.toMermaid(engine.graphQuery(storage, world, { minTension: 0, tokenBudget: 8000 })));

  // --- personas: authored by the host LLM
  const pTask = engine.buildPersonasTask(storage, world, { count: POP });
  const pRes = engine.applyPersonas(storage, world, pTask.id, load("02-personas.json"));
  if (pRes.rejected.length) {
    console.error("PERSONAS REJECTED by real validator:");
    console.error(JSON.stringify(pRes.rejected.slice(0, 8), null, 2));
    process.exit(1);
  }

  storage.updateWorld(world.id, { config: { ...storage.getWorld(world.id).config, rounds: ROUNDS, ensemble: { runCount: 5 } } });
  storage.setStage(world.id, "configured");
  fs.writeFileSync(STATE, JSON.stringify({ worldId: world.id, slug: world.slug, seed: SEED, rounds: ROUNDS }, null, 2));

  const w = storage.getWorld(world.id);
  const brief = briefSimTask(engine.buildSimBatch(storage, w).task);
  dump("round-1.task.json", brief);
  console.log(`world ${world.name} (${world.slug})  entities=${oRes.insertedCount}  personas=${storage.listPersonas(world.id).length}`);
  console.log(`ROUND 1 -> dump/round-1.task.json`);
  console.log(`  activated: ${brief.personas.map((p) => p.handle).join(", ")}`);
  storage.close();
}


// ---------------------------------------------------------------- submit
if (mode === "submit") {
  const n = Number(process.argv[3]);
  const st = loadState();
  const { storage } = open();
  const w0 = storage.getWorld(st.worldId);
  if (w0.round >= ROUNDS) {
    console.error(`all ${ROUNDS} rounds already complete`);
    process.exit(1);
  }
  const { task } = engine.buildSimBatch(storage, w0);
  const res = engine.submitGenerations(storage, w0, task.id, load(`round-${n}.json`), {});
  if (res.rejected.length) {
    console.error(`ROUND ${n}: real validator REJECTED ${res.rejected.length} item(s) — round HELD:`);
    console.error(JSON.stringify(res.rejected.slice(0, 10), null, 2));
    process.exit(1);
  }
  const w = storage.getWorld(st.worldId);
  console.log(`round ${n} committed: +${res.postsCreated} posts, advanced -> ${w.round}/${ROUNDS}`);

  // publish the post ids on disk so the next authored round can cite them
  const recent = storage.listPosts(st.worldId, { limit: 100000 }).filter((p) => p.round >= n - 1);
  dump(`posts-after-round-${n}.json`, recent.map((p) => ({ id: p.id, round: p.round, plat: p.platform, kind: p.kind, body: p.body })));
  console.log(`  post ids -> dump/posts-after-round-${n}.json`);

  if (w.round < ROUNDS) {
    const nx = engine.buildSimBatch(storage, w);
    const brief = briefSimTask(nx.task);
    dump(`round-${w.round + 1}.task.json`, brief);
    console.log(`ROUND ${w.round + 1} -> dump/round-${w.round + 1}.task.json (${brief.personas.length} activated: ${brief.personas.map((p) => p.handle).join(", ")})`);
  } else {
    dump("report.task.json", engine.buildReportTask(storage, w, "developer community reaction to the Acme Cloud pricing change").items[0].payload);
    console.log("REPORT task -> dump/report.task.json");
  }
  storage.close();
}


// ---------------------------------------------------------------- report
if (mode === "report") {
  const st = loadState();
  const { ws, storage } = open();
  const w = storage.getWorld(st.worldId);
  const validated = engine.validateReportDraft(storage, w, load("report.json"));
  if (validated.rejected.length) {
    console.error(`REPORT REJECTED by real validator (${validated.rejected.length}):`);
    console.error(JSON.stringify(validated.rejected.slice(0, 10), null, 2));
    process.exit(1);
  }
  const record = engine.storeReport(storage, w, validated.draft, "developer community reaction to the Acme Cloud pricing change");
  const md = engine.renderReportMarkdown(storage, w, record);
  const mdPath = ws.reportPath(w.slug, record.version);
  ws.writeAtomic(mdPath, md);
  const html = engine.renderReportHtml(storage, w, record);
  const htmlPath = ws.reportHtmlPath(w.slug, record.version);
  ws.writeAtomic(htmlPath, html);
  storage.db.prepare("UPDATE reports SET path=? WHERE id=?").run(ws.rel(htmlPath), record.id);
  console.log(`REPORT v${record.version} stored + rendered`);
  console.log(`  markdown: ${mdPath} (${md.length} chars)`);
  console.log(`  html:     ${htmlPath} (${html.length} chars)`);
  storage.close();
}

