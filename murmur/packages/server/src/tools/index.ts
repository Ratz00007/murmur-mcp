/**
 * Tool registry — 12 tools across 9 modules, one per pipeline concern.
 *
 * The tool surface was 29 names for 11 distinct capabilities. Nearly every
 * extra name was a synonym: the same setter registered twice, the same
 * ingestion path under three provenance names, and each stage's plan/submit
 * pair split across two catalog entries. Collapsing them buys a catalog an
 * agent can hold in its head without dropping a single capability — every old
 * tool name still has a row in MIGRATED_TOOLS below, and the receipts that
 * used to teach the next step now teach the new spelling of it.
 *
 * `TOOL_COUNT` is a declared expectation, not a description: `registerTools`
 * refuses to start if the modules stop agreeing with it, `tools.test.ts`
 * fails the build on drift, and the e2e asserts the count the live server
 * reports over the wire.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../session.js";
import { registerWorldTools, WORLD_TOOL_NAMES } from "./world.js";
import { registerSeedTools, SEED_TOOL_NAMES } from "./seeds.js";
import { registerOntologyTools, ONTOLOGY_TOOL_NAMES } from "./ontology.js";
import { registerGraphTools, GRAPH_TOOL_NAMES } from "./graph.js";
import { registerPersonaTools, PERSONAS_TOOL_NAMES } from "./personas.js";
import { registerSimTools, SIM_TOOL_NAMES } from "./sim.js";
import { registerReportTools, REPORT_TOOL_NAMES } from "./report.js";
import { registerMacroTools, MACRO_TOOL_NAMES } from "./macro.js";
import { registerInteractTools, INTERACT_TOOL_NAMES } from "./interact.js";

/** How many tools the server must register. Asserted three ways — see above. */
export const TOOL_COUNT = 12;

/** The exact set the server must expose, in registration order. */
export const TOOL_NAMES = [
  "world_init",
  "world_list",
  "world_config",
  "seed_add",
  "seeds_review",
  "ontology",
  "graph",
  "personas",
  "sim",
  "report",
  "macro_sim",
  "interact",
] as const;

/** Tool names each module owns, checked against TOOL_NAMES at registration. */
export const MODULE_TOOL_NAMES: Record<string, readonly string[]> = {
  world: WORLD_TOOL_NAMES,
  seeds: SEED_TOOL_NAMES,
  ontology: ONTOLOGY_TOOL_NAMES,
  graph: GRAPH_TOOL_NAMES,
  personas: PERSONAS_TOOL_NAMES,
  sim: SIM_TOOL_NAMES,
  report: REPORT_TOOL_NAMES,
  macro: MACRO_TOOL_NAMES,
  interact: INTERACT_TOOL_NAMES,
};

/**
 * Where the 29 pre-consolidation tool names went. Kept as the migration
 * record for anyone upgrading across this change.
 */
export const MIGRATED_TOOLS: Record<string, string> = {
  world_init: "world_init",
  world_list: "world_list (detail:'rows')",
  world_open: "world_list({world, detail:'open'})",
  world_status: "world_list({detail:'status'})",
  world_config: "world_config (absorbed sim_configure)",
  sim_configure: "world_config",
  seed_add_files: "seed_add({source:'files'})",
  seed_add_url: "seed_add({source:'url'})",
  seed_add_text: "seed_add({source:'text'})",
  seeds_review: "seeds_review",
  ontology_plan: "ontology({action:'plan'})",
  ontology_submit: "ontology({action:'submit'})",
  graph_build: "graph({action:'build'})",
  graph_query: "graph({action:'query'})",
  graph_export_mermaid: "graph({action:'export'})",
  personas_plan: "personas({action:'plan'})",
  personas_submit: "personas({action:'submit'})",
  persona_inspect: "personas({action:'inspect'})",
  persona_edit: "personas({action:'edit'})",
  sim_next_batch: "sim({action:'next_batch'})",
  sim_submit_generations: "sim({action:'submit'})",
  sim_inject_event: "sim({action:'inject'})",
  sim_round_summary: "sim({action:'summary'})",
  sim_timeline: "sim({action:'timeline'})",
  report_plan: "report({action:'plan'})",
  report_submit: "report({action:'submit'})",
  report_export: "report({action:'export'})",
  interview_agent: "interact({target:'persona'})",
  report_agent_ask: "interact({target:'run'})",
};

export function registerTools(server: McpServer, ctx: ServerContext): void {
  registerWorldTools(server, ctx);
  registerSeedTools(server, ctx);
  registerOntologyTools(server, ctx);
  registerGraphTools(server, ctx);
  registerPersonaTools(server, ctx);
  registerSimTools(server, ctx);
  registerReportTools(server, ctx);
  registerMacroTools(server, ctx);
  registerInteractTools(server, ctx);
  assertToolSurface();
}

/**
 * Fail loudly if the modules and the declared surface disagree.
 *
 * This is a startup assertion, not a build-time one: a drifted count is a
 * lie in the server instructions and the README, and the cheapest moment to
 * find out is before the first client connects.
 */
export function assertToolSurface(): void {
  const fromModules = Object.entries(MODULE_TOOL_NAMES).flatMap(
    ([mod, names]) => names.map((n) => `${mod}:${n}`),
  );
  const declared = new Set<string>(TOOL_NAMES);
  const seen = new Set<string>();
  const problems: string[] = [];

  for (const entry of fromModules) {
    const name = entry.slice(entry.indexOf(":") + 1);
    if (seen.has(name))
      problems.push(`${name} is claimed by more than one module`);
    seen.add(name);
    if (!declared.has(name))
      problems.push(`module registers ${name}, which TOOL_NAMES does not list`);
  }
  for (const name of TOOL_NAMES) {
    if (!seen.has(name))
      problems.push(`TOOL_NAMES lists ${name}, which no module registers`);
  }
  if (TOOL_COUNT !== TOOL_NAMES.length) {
    problems.push(
      `TOOL_COUNT is ${TOOL_COUNT} but TOOL_NAMES has ${TOOL_NAMES.length} entries`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `tool surface is inconsistent — ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`,
    );
  }
}
