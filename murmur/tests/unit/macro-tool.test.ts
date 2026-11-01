/**
 * Unit coverage for the macro_sim MCP tool (new in the 12-tool surface).
 *
 * Exercises the tool through the InMemoryTransport harness (the same pattern
 * tier5-server-adversarial.test.ts uses) against a real buildServer:
 *   1. macro_sim is part of the declared surface (TOOL_COUNT / TOOL_NAMES);
 *   2. zod schema validation rejects out-of-range params;
 *   3. a success run persists per-round snapshots that round-trip
 *      (save -> load returns equal state/metrics).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import { TOOL_COUNT, TOOL_NAMES } from "../../packages/server/src/tools/index.js";
import { loadMacroSnapshot } from "../../packages/engine/src/dynamics/macro-graph.js";
import { computeExecutiveARRRisk } from "../../packages/engine/src/report-executive.js";

async function createHarness() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-macro-tool-"));
  fs.mkdirSync(path.join(cwd, ".murmur"), { recursive: true });
  process.env.MURMUR_WORKSPACE = cwd;
  const ctx = new ServerContext(cwd);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(ctx);
  const client = new Client({ name: "macro-tool-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    cwd,
    ctx,
    client,
    async close() {
      await client.close().catch(() => {});
      ctx.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

interface CallResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function callTool(
  client: Client,
  args: { name: string; arguments?: Record<string, unknown> },
): Promise<CallResult> {
  return client.callTool(args) as unknown as Promise<CallResult>;
}

describe("macro_sim tool", () => {
  it("is listed in the declared surface (TOOL_COUNT / TOOL_NAMES)", () => {
    expect(TOOL_COUNT).toBe(12);
    expect(TOOL_NAMES).toContain("macro_sim");
  });

  it("rejects invalid params via zod schema validation", async () => {
    const h = await createHarness();
    try {
      await callTool(h.client, { name: "world_init", arguments: { name: "Macro World" } });

      // node_count above the 100k cap.
      const tooMany = await callTool(h.client, {
        name: "macro_sim",
        arguments: { node_count: 100_001 },
      });
      expect(tooMany.isError).toBe(true);

      // rounds above the 20 cap.
      const tooManyRounds = await callTool(h.client, {
        name: "macro_sim",
        arguments: { rounds: 21 },
      });
      expect(tooManyRounds.isError).toBe(true);

      // Non-integer node_count.
      const nonInt = await callTool(h.client, {
        name: "macro_sim",
        arguments: { node_count: 12.5 },
      });
      expect(nonInt.isError).toBe(true);
    } finally {
      await h.close();
    }
  });

  it("runs multi-round simulation, persists snapshots, and round-trips state", async () => {
    const h = await createHarness();
    try {
      const init = await callTool(h.client, {
        name: "world_init",
        arguments: { name: "Macro Roundtrip" },
      });
      const worldId = (init.structuredContent!.world as { id: string }).id;

      const res = await callTool(h.client, {
        name: "macro_sim",
        arguments: {
          node_count: 500,
          average_degree: 6,
          rounds: 3,
          shockwave: {
            nodes: [0, 1, 2],
            stanceShift: -0.7,
            deltaOutrage: 0.6,
            makeContagious: true,
          },
        },
      });

      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent!;
      expect(sc.ok).toBe(true);
      const summaries = sc.summaries as Array<{
        round: number;
        nodeCount: number;
        edgeCount: number;
        distribution: {
          susceptible: number;
          exposed: number;
          infected: number;
          contagious: number;
          churned: number;
        };
        meanStance: number;
        outrageIndex: number;
        durationMs: number;
      }>;
      expect(summaries).toHaveLength(3);

      for (let r = 1; r <= 3; r++) {
        const summary = summaries[r - 1];
        expect(summary.round).toBe(r);
        expect(summary.nodeCount).toBe(500);
        expect(summary.edgeCount).toBe(3000);

        const dist = summary.distribution;
        const total =
          dist.susceptible + dist.exposed + dist.infected + dist.contagious + dist.churned;
        expect(total).toBe(500);
        expect(typeof summary.meanStance).toBe("number");
        expect(typeof summary.outrageIndex).toBe("number");

        // Snapshot round-trip: loaded state must reproduce the summarized metrics.
        const loaded = loadMacroSnapshot(h.ctx.storage.db, worldId, r);
        expect(loaded).not.toBeNull();
        expect(loaded!.snapshot.round).toBe(r);
        expect(loaded!.snapshot.node_count).toBe(500);
        expect(loaded!.snapshot.edge_count).toBe(3000);
        expect(loaded!.snapshot.outrage_index).toBe(summary.outrageIndex);
        expect(JSON.parse(loaded!.snapshot.state_distribution)).toEqual(dist);
        expect(loaded!.state.nodeCount).toBe(500);
        expect(loaded!.state.edgeCount).toBe(3000);
      }
    } finally {
      await h.close();
    }
  });

  it("feeds a macro_sim summary into report executive mode", async () => {
    const h = await createHarness();
    try {
      await callTool(h.client, {
        name: "world_init",
        arguments: { name: "Exec Macro World" },
      });

      const res = await callTool(h.client, {
        name: "report",
        arguments: {
          action: "export",
          mode: "executive",
          total_arr: 50_000_000,
          macro_sim: {
            outrageIndex: 0.9,
            nodeCount: 500,
            stateDistribution: { churned: 50 }, // churn fraction 0.1
          },
        },
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent!;
      expect(sc.ok).toBe(true);

      const jsonFile = (sc.files as Array<{ path: string }>).find((f) =>
        f.path.endsWith(".json"),
      )!;
      expect(jsonFile).toBeDefined();
      const parsed = JSON.parse(
        fs.readFileSync(path.join(h.cwd, jsonFile.path), "utf8"),
      );

      // The macro_sim summary must drive the risk model exactly as production does.
      const expected = computeExecutiveARRRisk(50_000_000, 0.9, 0.1);
      expect(parsed.arrRisk.totalARR).toBe(expected.totalARR);
      expect(parsed.arrRisk.grossARRAtRisk).toBe(expected.grossARRAtRisk);
      expect(parsed.arrRisk.expectedChurnLossARR).toBe(expected.expectedChurnLossARR);
      expect(parsed.arrRisk.netARRWaterfall).toEqual(expected.netARRWaterfall);
    } finally {
      await h.close();
    }
  });
});
