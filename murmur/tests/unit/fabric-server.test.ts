/**
 * Persona Fabric through the live MCP server — Phase B tool surface.
 *
 * Mirrors tools.test.ts: InMemoryTransport + buildServer + a real
 * ServerContext in a temp workspace, structuredContent validated against the
 * declared PERSONAS_OUTPUT/SIM_OUTPUT schemas. TOOL_COUNT stays 11 — the
 * fabric rides the existing `personas` and `sim` tools as new actions, never
 * as new registrations. Every fabric-derived reply must carry the honesty
 * block (personaCount + surrogate metrics + exact disclaimer).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  SURROGATE_DISCLAIMER,
  TRAIT_COUNT,
  fit as fitSurrogate,
  mulberry32,
  type FabricExample,
} from "@murmur/engine";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import { TOOL_COUNT } from "../../packages/server/src/tools/index.js";
import { PERSONAS_OUTPUT, SIM_OUTPUT } from "../../packages/server/src/tools/outputs.js";

interface Session {
  client: Client;
  ctx: ServerContext;
  cwd: string;
}

async function startSession(): Promise<Session> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-fabric-"));
  fs.mkdirSync(path.join(cwd, ".murmur"), { recursive: true });
  process.env.MURMUR_WORKSPACE = cwd;
  const ctx = new ServerContext(cwd);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fabric-tool-test", version: "0.0.0" });
  await buildServer(ctx).connect(serverTransport);
  await client.connect(clientTransport);
  await client.callTool({ name: "world_init", arguments: { name: "fabric" } });
  return { client, ctx, cwd };
}

async function closeSession(s: Session): Promise<void> {
  await s.client.close().catch(() => {});
  s.ctx.close();
  fs.rmSync(s.cwd, { recursive: true, force: true });
}

function examples(count = 300): FabricExample[] {
  const rng = mulberry32(555);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const traits = Array.from({ length: TRAIT_COUNT }, () => rng());
    const price = traits[0];
    out.push({
      traits,
      claimId: "price-hike",
      support: price < 0.5 ? 1 : 0,
      objectionId: price > 0.7 ? "too_expensive" : "lock_in",
      choiceId: price > 0.5 ? "switch" : "stay",
    });
  }
  return out;
}

describe("personas tool — fabric actions", () => {
  it("keeps the tool surface at TOOL_COUNT with fabric as actions, not tools", () => {
    expect(TOOL_COUNT).toBe(12);
  });

  it("fabricates a population and returns the summary with the honesty block", async () => {
    const s = await startSession();
    try {
      const res = await s.client.callTool({
        name: "personas",
        arguments: {
          action: "fabricate",
          count: 64,
          seed: "server-seed",
          archetypeWeights: { oss_maintainer: 3, lurker: 1 },
        },
      });
      expect(res.isError).toBeFalsy();
      const out = res.structuredContent as Record<string, unknown>;
      expect(PERSONAS_OUTPUT.safeParse(out).success).toBe(true);
      const fabric = out.fabric as Record<string, unknown>;
      expect(fabric.population).toBe(64);
      expect(fabric.seed).toBe("server-seed");
      expect(fabric.modelAttached).toBe(false);
      const shares = fabric.archetypeShares as Record<string, number>;
      expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(Object.keys(fabric.traitMeans as Record<string, number>)).toHaveLength(
        TRAIT_COUNT,
      );
      // Honesty block, exactly the mandated shape.
      expect(fabric.honesty).toEqual({
        personaCount: 64,
        surrogate: { holdoutAccuracy: 0, labeledCount: 0, effectiveSampleSize: 0 },
        disclaimer: SURROGATE_DISCLAIMER,
      });
    } finally {
      await closeSession(s);
    }
  });

  it("replays byte-identical summaries across independent workspaces for the same seed", async () => {
    const run = async (): Promise<string> => {
      const s = await startSession();
      try {
        const res = await s.client.callTool({
          name: "personas",
          arguments: {
            action: "fabricate",
            count: 256,
            seed: "cross-workspace-seed",
          },
        });
        const fabric = (res.structuredContent as Record<string, unknown>)
          .fabric as Record<string, unknown>;
        return JSON.stringify({
          shares: fabric.archetypeShares,
          means: fabric.traitMeans,
        });
      } finally {
        await closeSession(s);
      }
    };
    expect(await run()).toBe(await run());
  });

  it("materializes an uncalibrated view, identical on repeat", async () => {
    const s = await startSession();
    try {
      await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 32, seed: "mat-seed" },
      });
      const args = {
        name: "personas",
        arguments: {
          action: "materialize",
          personaId: "#7",
          claimId: "no-such-claim",
        },
      };
      const a = await s.client.callTool(args);
      const b = await s.client.callTool(args);
      const out = a.structuredContent as Record<string, unknown>;
      expect(PERSONAS_OUTPUT.safeParse(out).success).toBe(true);
      expect(out.uncalibrated).toBe(true);
      const view = out.personaView as Record<string, unknown>;
      expect(view.calibration).toBe("uncalibrated");
      expect(view.personaId).toBe("#7");
      expect(JSON.stringify(a.structuredContent)).toBe(
        JSON.stringify(b.structuredContent),
      );
    } finally {
      await closeSession(s);
    }
  });

  it("materializes a calibrated view once a surrogate model is attached", async () => {
    const s = await startSession();
    try {
      await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 32, seed: "cal-seed" },
      });
      const { model } = fitSurrogate(examples(), { seed: "cal-fit" });
      const w = s.ctx.resolveWorld(undefined);
      const state = s.ctx.fabric.get(w)!;
      s.ctx.fabric.save(w, { ...state, model });

      const res = await s.client.callTool({
        name: "personas",
        arguments: {
          action: "materialize",
          personaId: "#3",
          claimId: "price-hike",
        },
      });
      const out = res.structuredContent as Record<string, unknown>;
      expect(out.uncalibrated).toBe(false);
      const view = out.personaView as Record<string, unknown>;
      expect(view.calibration).toBe("calibrated");
      expect(view.stance).toBeGreaterThanOrEqual(-1);
      expect(view.stance).toBeLessThanOrEqual(1);
      expect(view.honesty).toEqual({
        personaCount: 32,
        surrogate: {
          holdoutAccuracy: model.metrics.holdoutAccuracy,
          labeledCount: 300,
          effectiveSampleSize: 300,
        },
        disclaimer: SURROGATE_DISCLAIMER,
      });
    } finally {
      await closeSession(s);
    }
  });

  it("remembers a statement and reflects it in the next materialization", async () => {
    const s = await startSession();
    try {
      await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 16, seed: "mem-seed" },
      });
      const remember = await s.client.callTool({
        name: "personas",
        arguments: {
          action: "remember",
          personaId: "#2",
          text: "I will not renew above $50",
        },
      });
      expect(remember.isError).toBeFalsy();
      const remembered = remember.structuredContent as Record<string, unknown>;
      expect(remembered.personaId).toBe("#2");
      expect(remembered.remembered).toBe(1);
      expect(PERSONAS_OUTPUT.safeParse(remembered).success).toBe(true);

      const view = (await s.client.callTool({
        name: "personas",
        arguments: {
          action: "materialize",
          personaId: "#2",
          claimId: "price-hike",
        },
      }).then((r) => (r.structuredContent as Record<string, unknown>).personaView)) as Record<
        string,
        unknown
      >;
      const memory = view.memory as { text: string }[];
      expect(memory).toHaveLength(1);
      expect(memory[0].text).toBe("I will not renew above $50");
      expect(view.rationale).toContain("Previously stated");
      expect(view.rationale).toContain("I will not renew above $50");
    } finally {
      await closeSession(s);
    }
  });

  it("fails fabric actions that need a population when none is active", async () => {
    const s = await startSession();
    try {
      const res = await s.client.callTool({
        name: "personas",
        arguments: { action: "materialize", personaId: "#0", claimId: "c" },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("no fabric population active");
    } finally {
      await closeSession(s);
    }
  });

  it("rejects fabric counts above the 1,000,000 ceiling at the schema boundary", async () => {
    const s = await startSession();
    try {
      // The SDK surfaces inputSchema violations as isError replies naming the
      // tool; the plan-range guard fires inside the handler the same way.
      const oversize = await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 2_000_000, seed: "s" },
      });
      expect(oversize.isError).toBe(true);
      expect(JSON.stringify(oversize.content)).toMatch(/personas/i);
      const planRange = await s.client.callTool({
        name: "personas",
        arguments: { action: "plan", count: 5000 },
      });
      expect(planRange.isError).toBe(true);
      expect(JSON.stringify(planRange.content)).toMatch(/8\.\.128/);
    } finally {
      await closeSession(s);
    }
  });
});

describe("sim tool — fabric honesty block", () => {
  it("includes the fabric honesty block once a population is active", async () => {
    const s = await startSession();
    try {
      const before = await s.client.callTool({
        name: "sim",
        arguments: { action: "timeline" },
      });
      expect((before.structuredContent as Record<string, unknown>).fabric).toBeUndefined();

      await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 128, seed: "sim-seed" },
      });
      const after = await s.client.callTool({
        name: "sim",
        arguments: { action: "timeline" },
      });
      const out = after.structuredContent as Record<string, unknown>;
      expect(SIM_OUTPUT.safeParse(out).success).toBe(true);
      const fabric = out.fabric as Record<string, unknown>;
      expect(fabric.active).toBe(true);
      expect((fabric.honesty as Record<string, unknown>).personaCount).toBe(128);
    } finally {
      await closeSession(s);
    }
  });
});

describe("fabric honesty across every fabric-derived reply", () => {
  it("prints personaCount + surrogate metrics + the exact disclaimer on each action", async () => {
    const s = await startSession();
    try {
      const fabricate = await s.client.callTool({
        name: "personas",
        arguments: { action: "fabricate", count: 48, seed: "honesty-seed" },
      });
      const fabric = (fabricate.structuredContent as Record<string, unknown>)
        .fabric as Record<string, unknown>;
      const honesty = fabric.honesty as Record<string, unknown>;
      expect(honesty.personaCount).toBe(48);
      expect(
        (honesty.surrogate as Record<string, unknown>).effectiveSampleSize,
      ).toBe(0); // no model yet — the block still prints, honestly zeroed
      expect(honesty.disclaimer).toBe(SURROGATE_DISCLAIMER);

      await s.client.callTool({
        name: "personas",
        arguments: { action: "remember", personaId: "#1", text: "pricing note" },
      });
      const materialize = await s.client.callTool({
        name: "personas",
        arguments: {
          action: "materialize",
          personaId: "#1",
          claimId: "pricing",
        },
      });
      const view = (materialize.structuredContent as Record<string, unknown>)
        .personaView as Record<string, unknown>;
      const viewHonesty = view.honesty as Record<string, unknown>;
      expect(viewHonesty.personaCount).toBe(48);
      expect(viewHonesty.disclaimer).toBe(SURROGATE_DISCLAIMER);
    } finally {
      await closeSession(s);
    }
  });
});
