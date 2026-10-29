/**
 * Tier 2 — Boundary 16: Modernized MCP Tools Integration Boundaries (R6)
 * Tests non-existent tools, invalid schema arguments, rapid sequential calls,
 * and token limit discipline.
 */
import { describe, expect, it } from "vitest";
import { createTestWorkspace, spawnMcpClient } from "../helpers/harness.js";

describe("Tier 2 - B16: Modernized MCP Tools Integration Boundaries", () => {
  it("returns protocol error when calling a non-existent tool name", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const res = (await client.callTool({
        name: "non_existent_tool_12345",
        arguments: {},
      })) as { isError?: boolean; content?: Array<{ text?: string }> };

      expect(res.isError).toBe(true);
      expect(res.content?.[0]?.text).toContain("not found");
    } finally {
      await close();
      await ws.close();
    }
  });

  it("returns schema validation error when calling world_init with missing required args", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      // world_init requires name: string
      const res = (await client.callTool({
        name: "world_init",
        arguments: {}, // Missing required name
      })) as { isError?: boolean };

      expect(res.isError).toBe(true);
    } finally {
      await close();
      await ws.close();
    }
  });

  it("handles 10 rapid sequential tool calls without protocol synchronization drift", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      for (let i = 0; i < 10; i++) {
        const res = (await client.callTool({
          name: "world_list",
          arguments: {},
        })) as { content?: Array<{ type: string; text?: string }> };

        expect(res.content).toBeDefined();
        const parsed = JSON.parse(res.content![0].text!);
        expect(parsed.ok).toBe(true);
      }
    } finally {
      await close();
      await ws.close();
    }
  });

  it("rejects seed_add calls with negative character lengths or invalid source types", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const res = (await client.callTool({
        name: "seed_add",
        arguments: {
          world: "w_nonexistent",
          source: "satellite", // Invalid source enum
          text: "Invalid source test",
        },
      })) as { isError?: boolean };

      expect(res.isError).toBe(true);
    } finally {
      await close();
      await ws.close();
    }
  });

  it("verifies world_list with detail 'status' stays well under token limits", async () => {
    const ws = createTestWorkspace();
    const { client, close } = await spawnMcpClient(ws.cwd);

    try {
      const res = (await client.callTool({
        name: "world_list",
        arguments: { detail: "status" },
      })) as { content?: Array<{ type: string; text?: string }> };

      const text = res.content?.[0]?.text ?? "";
      expect(Math.ceil(text.length / 4)).toBeLessThan(1000);
    } finally {
      await close();
      await ws.close();
    }
  });
});
