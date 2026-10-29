/**
 * Arm B driver (v2): runs the full Murmur pipeline over the MCP server with a
 * HUMAN as the host model, using the SDK client exactly as e2e.test.ts does.
 * Raw JSON-RPC was attempted first and abandoned: hand-rolling the handshake
 * risks protocol details that the SDK already gets right.
 *
 * The script executes plan steps and dumps each task; the operator authors
 * each submit JSON; the script validates and continues. Neither the operator
 * nor the script ever sees the reaction thread or the answer key.
 *
 * World: 8 personas x 3 rounds. Same machinery as defaults, smaller world.
 * Parameters are recorded, not hidden.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url)); // murmur/
const ROOT = join(HERE, ".."); // repo root
const BENCH = join(ROOT, "bench");
const TASK_DIR = join(BENCH, "data-vendor", "arms", "v4-arm-b-tasks");
const SUBMIT_DIR = join(BENCH, "data-vendor", "arms", "v4-arm-b-submits");
const STATE_FILE = join(BENCH, "data-vendor", "arms", "v4-arm-b-state.json");
const WORKSPACE = join(BENCH, "data-vendor", "arms", "v4-arm-b-world");
const SERVER = join(HERE, "packages", "server", "dist", "index.js");
mkdirSync(TASK_DIR, { recursive: true });
mkdirSync(SUBMIT_DIR, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });

const ANNOUNCEMENT = readFileSync(join(BENCH, "data-vendor", "v4-announcement.txt"), "utf8");

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { step: "init", taskIds: {}, round: 0 };
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function main() {
  const mode = process.argv[2]; // plan | submit
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER], cwd: WORKSPACE,
    env: { ...process.env, MURMUR_LOG: "error" },
  });
  const client = new Client({ name: "arm-b", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.find((c) => c.type === "text")?.text ?? "";
    return JSON.parse(text);
  };
  const state = loadState();

  try {
    if (mode === "plan" && state.step === "init") {
      const world = await call("world_init", { name: "scaleway-price-hike", description: "Scaleway June 2026 pricing update", seed: "arm-b-v4" });
      if (!world.ok) throw new Error("world_init: " + JSON.stringify(world));
      await call("seed_add", { source: "text", title: "Scaleway pricing update June 2026", text: ANNOUNCEMENT });
      await call("world_config", { rounds: 3 });
      const plan = await call("ontology", { action: "plan" });
      writeFileSync(join(TASK_DIR, "01-ontology-plan.json"), JSON.stringify(plan, null, 2));
      state.worldId = world.world.id;
      state.taskIds.ontology = plan.taskId;
      state.step = "ontology-submit";
      saveState(state);
      console.log("WROTE 01-ontology-plan.json");
      console.log("NEXT: author " + join(SUBMIT_DIR, "01-ontology.json") + ' as {"result": {...}}, then: node bench/arm-b-driver.mjs submit');
    } else if (mode === "submit") {
      const step = state.step;
      if (step === "ontology-submit") {
        const sub = JSON.parse(readFileSync(join(SUBMIT_DIR, "01-ontology.json"), "utf8"));
        const res = await call("ontology", { action: "submit", task_id: state.taskIds.ontology, result: sub.result ?? sub });
        console.log("ontology submit:", JSON.stringify({ ok: res.ok, rejected: res.rejected }));
        if (!res.ok) { console.log("FIX and re-run submit."); return; }
        await call("graph", { action: "build" });
        const plan = await call("personas", { action: "plan", count: 8 });
        writeFileSync(join(TASK_DIR, "02-personas-plan.json"), JSON.stringify(plan, null, 2));
        state.taskIds.personas = plan.taskId;
        state.step = "personas-submit";
        saveState(state);
        console.log("WROTE 02-personas-plan.json. Author 02-personas.json, then submit.");
      } else if (step === "personas-submit") {
        const sub = JSON.parse(readFileSync(join(SUBMIT_DIR, "02-personas.json"), "utf8"));
        const res = await call("personas", { action: "submit", task_id: state.taskIds.personas, result: sub.result ?? sub });
        console.log("personas submit:", JSON.stringify({ ok: res.ok, rejected: res.rejected, population: res.population }));
        if (!res.ok) { console.log("FIX and re-run submit."); return; }
        const batch = await call("sim", { action: "next_batch" });
        writeFileSync(join(TASK_DIR, "03-sim-r1-batch.json"), JSON.stringify(batch, null, 2));
        state.taskIds.sim = batch.taskId;
        state.round = 1;
        state.step = "sim";
        saveState(state);
        console.log("WROTE 03-sim-r1-batch.json. Author 03-sim-r1.json, then submit.");
      } else if (step === "sim") {
        const r = state.round;
        const sub = JSON.parse(readFileSync(join(SUBMIT_DIR, `0${2 + r}-sim-r${r}.json`), "utf8"));
        const res = await call("sim", { action: "submit", task_id: state.taskIds.sim, generations: sub.generations ?? [], finalize: sub.finalize ?? false });
        console.log(`sim r${r} submit:`, JSON.stringify({ ok: res.ok, advanced: res.advanced, rejected: res.rejected }));
        if (!res.ok) { console.log("FIX and re-run submit."); return; }
        if (r >= 3) {
          const plan = await call("report", { action: "plan", mode: "dossier" });
          writeFileSync(join(TASK_DIR, "06-dossier-plan.json"), JSON.stringify(plan, null, 2));
          state.taskIds.dossier = plan.taskId;
          state.step = "dossier-submit";
          saveState(state);
          console.log("WROTE 06-dossier-plan.json. Author 07-dossier.json, then submit.");
        } else {
          state.round = r + 1;
          const batch = await call("sim", { action: "next_batch" });
          writeFileSync(join(TASK_DIR, `0${2 + state.round}-sim-r${state.round}-batch.json`), JSON.stringify(batch, null, 2));
          state.taskIds.sim = batch.taskId;
          saveState(state);
          console.log(`WROTE batch for round ${state.round}. Author the submit, then submit.`);
        }
      } else if (step === "dossier-submit") {
        const sub = JSON.parse(readFileSync(join(SUBMIT_DIR, "07-dossier.json"), "utf8"));
        const res = await call("report", { action: "submit", task_id: state.taskIds.dossier, draft: sub.draft ?? sub });
        console.log("dossier submit:", JSON.stringify({ ok: res.ok, rejected: res.rejected, version: res.version }));
        if (!res.ok) { console.log("FIX and re-run submit."); return; }
        const exp = await call("report", { action: "export", mode: "dossier", version: res.version });
        console.log("dossier export:", JSON.stringify(exp.files ?? exp));
        state.step = "done";
        saveState(state);
        console.log("DONE.");
      } else {
        console.log(`nothing to do for step=${step}`);
      }
    } else {
      console.log(`usage: node bench/arm-b-driver.mjs [plan|submit]  (state.step=${state.step})`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

await main();


