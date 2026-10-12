/** Adapters + prompts unit tests. */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CLIENTS, detectClients, findClient, renderInstall } from "@murmur/adapters";
import { PROMPTS, findPrompt } from "@murmur/prompts";
import { SCENARIOS, findScenario } from "@murmur/templates";

describe("adapters", () => {
  it("ships the 10-client launch matrix", () => {
    expect(CLIENTS.length).toBe(10);
    const ids = CLIENTS.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["claude-code", "codex", "gemini-cli", "antigravity", "opencode", "hermes", "cursor", "windsurf", "cline-continue", "vscode"]));
  });
  it("every snippet targets the murmur server entry", () => {
    for (const c of CLIENTS) {
      const snippet = c.configSnippet({ command: "npx", args: ["-y", "murmur-mcp"] });
      expect(snippet).toContain("murmur");
      expect(snippet).toContain("murmur-mcp");
    }
  });
  it("renders custom server commands for repo checkouts", () => {
    const rendered = renderInstall(findClient("cursor")!, { command: "node", args: ["/x/dist/index.js"] });
    expect(rendered).toContain("node /x/dist/index.js");
  });
  it("detects nothing in an empty workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-adapters-"));
    expect(detectClients(dir, dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("prompts", () => {
  it("ships the four playbooks", () => {
    expect(PROMPTS.map((p) => p.name).sort()).toEqual(["murmur-interview", "murmur-predict", "murmur-resume", "murmur-simulate"]);
  });
  it("playbooks name their tools", () => {
    // The 29-tool surface was consolidated to 11 action-dispatched tools, so
    // the playbooks name the new surface. What is asserted is that a playbook
    // never sends a model toward a tool that does not exist.
    const predict = findPrompt("predict")!;
    const text = predict.build({ question: "How will r/programming react to the pricing page?" });
    expect(text).toContain("world_init");
    expect(text).toContain("sim(");
    expect(text).toContain("report");
    const resume = findPrompt("resume")!;
    const resumeText = resume.build({});
    expect(resumeText).toContain("world_list");
    // And no playbook may name a retired tool: a stale name in a prompt is a
    // guaranteed failed call for every model that follows it. (world_config
    // survives — sim_configure was merged INTO it — so it is not retired.)
    const retired = [
      "world_open", "world_status", "sim_configure",
      "seed_add_files", "seed_add_url", "seed_add_text",
      "ontology_plan", "ontology_submit",
      "graph_build", "graph_query", "graph_export_mermaid",
      "personas_plan", "personas_submit", "persona_inspect", "persona_edit",
      "sim_next_batch", "sim_submit_generations", "sim_inject_event", "sim_round_summary", "sim_timeline",
      "report_plan", "report_submit", "report_export",
      "interview_agent", "report_agent_ask",
    ];
    for (const prompt of PROMPTS) {
      const built = prompt.build({});
      for (const old of retired) {
        expect(built, `${prompt.name} names retired tool ${old}`).not.toContain(old);
      }
    }
  });
});

describe("templates", () => {
  it("ships the five scenario packs with suggested settings", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["launch", "policy", "crisis", "finance", "fiction"]);
    for (const s of SCENARIOS) {
      expect(s.suggested.rounds).toBeGreaterThanOrEqual(6);
      expect(s.markdown).toContain("{{");
    }
    expect(findScenario("launch")!.suggested.personas).toBe(24);
  });
});
