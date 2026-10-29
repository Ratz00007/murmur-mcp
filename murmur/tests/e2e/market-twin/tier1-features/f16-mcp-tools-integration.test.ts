/**
 * Tier 1 — Feature 16: Modernized MCP Tools Integration (R6)
 * Validates stdio MCP client connectivity, tool listing, world initialization,
 * seed addition, structured JSON responses, and <=12,000 token response discipline.
 */
import { describe, expect, it } from "vitest";
import { createTestWorkspace, spawnMcpClient } from "../helpers/harness.js";
import { buildCompleteExecutiveReport } from "../helpers/reference-engine.js";
import { validateExecutiveDecisionReport } from "../helpers/contracts.js";

describe("Tier 1 - F16: Modernized MCP Tools Integration", () => {
  it("spawns live MCP server over stdio and verifies registered tool surface", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThanOrEqual(11);

      const toolNames = new Set(tools.tools.map((t) => t.name));
      expect(toolNames.has("world_init")).toBe(true);
      expect(toolNames.has("seed_add")).toBe(true);
      expect(toolNames.has("sim")).toBe(true);
      expect(toolNames.has("report")).toBe(true);
      expect(toolNames.has("interact")).toBe(true);
    } finally {
      await close();
      await ws.close();
    }
  });

  it("calls world_init and receives structured receipt with world ID and slug", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const res = (await client.callTool({
        name: "world_init",
        arguments: { name: "E2E Test World", description: "Integration test" },
      })) as { content?: Array<{ type: string; text?: string }> };

      expect(res.content).toBeDefined();
      const text = res.content?.find((c) => c.type === "text")?.text ?? "";
      expect(text.length).toBeGreaterThan(0);

      const parsed = JSON.parse(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.world.id).toBeDefined();
      expect(parsed.world.slug).toBe("e2e-test-world");
    } finally {
      await close();
      await ws.close();
    }
  });

  it("adds text seed via seed_add and confirms seed creation receipt", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const initRes = (await client.callTool({
        name: "world_init",
        arguments: { name: "Seed Test World" },
      })) as { content?: Array<{ type: string; text?: string }> };
      const initParsed = JSON.parse(initRes.content![0].text!);
      const worldId = initParsed.world.id;

      const seedRes = (await client.callTool({
        name: "seed_add",
        arguments: {
          world: worldId,
          source: "text",
          title: "Pricing Policy",
          text: "All new accounts will be billed on resource consumption starting next month.",
        },
      })) as { content?: Array<{ type: string; text?: string }> };

      const seedParsed = JSON.parse(seedRes.content![0].text!);
      expect(seedParsed.ok).toBe(true);
      expect(seedParsed.seed.id).toBeDefined();
      expect(seedParsed.seed.title).toBe("Pricing Policy");
    } finally {
      await close();
      await ws.close();
    }
  });

  it("generates comprehensive Executive Decision Report conforming to interface contracts", () => {
    const report = buildCompleteExecutiveReport({
      vendor: "EnterpriseHost",
      topic: "seat to consumption pricing transition",
      totalARR: 45_000_000,
      macroOutrage: 0.72,
      churnFraction: 0.16,
      competitors: [
        { name: "OpenCloud", isOSS: true, featureParity: 0.8, switchingFriction: 0.4 },
        { name: "LegacyHost", isOSS: false, featureParity: 0.9, switchingFriction: 0.7 },
      ],
    });

    const validated = validateExecutiveDecisionReport(report);
    expect(validated.arrRisk.totalARR).toBe(45_000_000);
    expect(validated.arrRisk.expectedChurnLossARR).toBeGreaterThan(0);
    expect(validated.competitorMigration.length).toBe(2);
    expect(validated.mediaHeadlines.length).toBe(4);
    expect(validated.vaccineRewrites.length).toBe(3);
    expect(validated.renderedHtmlDashboard).toContain("<!DOCTYPE html>");
  });

  it("enforces <= 12,000 token resource envelope on tool responses", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const res = (await client.callTool({
        name: "world_list",
        arguments: {},
      })) as { content?: Array<{ type: string; text?: string }> };

      const text = res.content?.find((c) => c.type === "text")?.text ?? "";
      const estTokens = Math.ceil(text.length / 4);
      expect(estTokens).toBeLessThanOrEqual(12_000);
    } finally {
      await close();
      await ws.close();
    }
  });
});
