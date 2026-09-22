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
    const predict = findPrompt("predict")!;
    const text = predict.build({ question: "How will r/programming react to the pricing page?" });
    expect(text).toContain("world_init");
    expect(text).toContain("sim_submit_generations");
    expect(text).toContain("report_export");
    const resume = findPrompt("resume")!;
    expect(resume.build({})).toContain("world_status");
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
