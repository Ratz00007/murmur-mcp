/**
 * Tier 5 — White-Box Adversarial Coverage Hardening & Gap Audit:
 * Complete adversarial verification of @murmur/server, 11 MCP Server Tools,
 * schema validations, boundary inputs, and cleanroom invariants.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../packages/server/src/server.js";
import { ServerContext } from "../../packages/server/src/session.js";
import {
  assertToolSurface,
  TOOL_COUNT,
  TOOL_NAMES,
} from "../../packages/server/src/tools/index.js";
import { TOOL_OUTPUTS } from "../../packages/server/src/tools/outputs.js";
// @ts-expect-error gate.mjs is untyped JS release gate script
import { runGate } from "../cleanroom/gate.mjs";

interface McpHarness {
  cwd: string;
  ctx: ServerContext;
  client: Client;
  close: () => Promise<void>;
}

async function createMcpHarness(): Promise<McpHarness> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-tier5-"));
  fs.mkdirSync(path.join(cwd, ".murmur"), { recursive: true });
  process.env.MURMUR_WORKSPACE = cwd;
  const ctx = new ServerContext(cwd);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = buildServer(ctx);
  const client = new Client({ name: "tier5-client", version: "1.0.0" });
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

async function callTool<T = unknown>(
  client: Client,
  args: { name: string; arguments?: Record<string, unknown> },
): Promise<T> {
  const res = await client.callTool(args);
  return res as unknown as T;
}

describe("Tier 5: Cleanroom & Tool Surface Invariants", () => {
  it("enforces cleanroom gate: zero network, zero process/eval, zero API keys, and exact closure", async () => {
    const report = await runGate();
    for (const check of report.checks) {
      expect(check.pass, `Cleanroom gate check failed: ${check.name} - ${check.detail}`).toBe(true);
    }
    expect(report.pass).toBe(true);
  }, 180_000);

  it("verifies tool surface invariant: exactly 12 declared tools without drift or duplicate", () => {
    expect(TOOL_COUNT).toBe(12);
    expect(TOOL_NAMES).toHaveLength(12);
    expect(new Set(TOOL_NAMES).size).toBe(12);
    expect(() => assertToolSurface()).not.toThrow();
  });

  it("ensures live in-memory server exposes all 12 tools with valid input and output schemas", async () => {
    const harness = await createMcpHarness();
    try {
      const list = await harness.client.listTools();
      expect(list.tools).toHaveLength(12);
      const toolNames = list.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([...TOOL_NAMES].sort());

      for (const tool of list.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        expect((tool.outputSchema as { type?: string }).type).toBe("object");
      }

      // The 4 task generation tools declare taskSupport: "optional"
      for (const stageName of ["ontology", "personas", "sim", "report"]) {
        const found = list.tools.find((t) => t.name === stageName);
        expect(found?.execution?.taskSupport).toBe("optional");
      }
    } finally {
      await harness.close();
    }
  });
});

describe("Tier 5: Tools 1, 2, 3 (world_init, world_list, world_config)", () => {
  it("world_init handles unicode, special characters, max boundary lengths, and seeds", async () => {
    const harness = await createMcpHarness();
    try {
      // 80 character name (exact max limit)
      const maxName = "A".repeat(80);
      const resMax = await callTool<{ content: Array<{ text: string }>; structuredContent: Record<string, unknown> }>(
        harness.client,
        {
          name: "world_init",
          arguments: { name: maxName, description: "Max length name test", seed: "seed-80" },
        },
      );

      expect(resMax.structuredContent.ok).toBe(true);
      expect((resMax.structuredContent.world as { name: string }).name).toBe(maxName);

      // 81 character name (violates z.string().max(80)) -> must fail validation
      const resOverflow = await callTool<{ isError?: boolean }>(
        harness.client,
        {
          name: "world_init",
          arguments: { name: "B".repeat(81) },
        },
      );
      expect(resOverflow.isError).toBe(true);

      // Unicode and symbol name
      const resUnicode = await callTool<{ structuredContent: Record<string, unknown> }>(
        harness.client,
        {
          name: "world_init",
          arguments: { name: "🚀 AI Market Twin @ 2026: 100% #1", seed: "fixed-determ-seed" },
        },
      );
      expect(resUnicode.structuredContent.ok).toBe(true);
      const worldObj = resUnicode.structuredContent.world as { slug: string; seed: string };
      expect(worldObj.slug).toBeDefined();
      expect(worldObj.seed).toBe("fixed-determ-seed");
    } finally {
      await harness.close();
    }
  });

  it("world_list enforces detail modes, active world switching, and status readout", async () => {
    const harness = await createMcpHarness();
    try {
      // 1. world_list on empty workspace returns empty rows
      const resEmpty = await callTool<{ structuredContent: { ok: boolean; worlds: unknown[]; next: string } }>(
        harness.client,
        {
          name: "world_list",
          arguments: { detail: "rows" },
        },
      );
      expect(resEmpty.structuredContent.ok).toBe(true);
      expect(resEmpty.structuredContent.worlds).toHaveLength(0);
      expect(resEmpty.structuredContent.next).toContain("world_init");

      // 2. detail: "open" without world must fail
      const resOpenFail = await callTool<{ isError?: boolean; content: Array<{ text: string }> }>(
        harness.client,
        {
          name: "world_list",
          arguments: { detail: "open" },
        },
      );
      expect(resOpenFail.isError).toBe(true);
      expect(resOpenFail.content[0].text).toContain("needs a world");

      // 3. Create two worlds and switch active world
      const w1 = await callTool<{ structuredContent: { world: { id: string } } }>(
        harness.client,
        {
          name: "world_init",
          arguments: { name: "World Alpha" },
        },
      );
      const w1Id = w1.structuredContent.world.id;

      const w2 = await callTool<{ structuredContent: { world: { id: string } } }>(
        harness.client,
        {
          name: "world_init",
          arguments: { name: "World Beta" },
        },
      );
      const w2Id = w2.structuredContent.world.id;
      expect(harness.ctx.activeWorldId).toBe(w2Id);

      // Open World Alpha -> switches active world to Alpha
      const resOpenW1 = await callTool<{ structuredContent: { ok: boolean; world: { id: string } } }>(
        harness.client,
        {
          name: "world_list",
          arguments: { world: w1Id, detail: "open" },
        },
      );
      expect(resOpenW1.structuredContent.ok).toBe(true);
      expect(resOpenW1.structuredContent.world.id).toBe(w1Id);
      expect(harness.ctx.activeWorldId).toBe(w1Id);

      // 4. Status readout conforming to WORLD_LIST_OUTPUT
      const resStatus = await callTool<{ structuredContent: Record<string, unknown> }>(
        harness.client,
        {
          name: "world_list",
          arguments: { detail: "status" },
        },
      );
      expect(resStatus.structuredContent.ok).toBe(true);
      expect(resStatus.structuredContent.world).toBeDefined();
      expect(TOOL_OUTPUTS.world_list.safeParse(resStatus.structuredContent).success).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("world_config validates boundary constraints and protects monotonic round progression", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Config World" },
      });

      // Valid tuning
      const resValid = await callTool<{ structuredContent: { ok: boolean; rounds: number; config: unknown } }>(
        harness.client,
        {
          name: "world_config",
          arguments: {
            rounds: 12,
            virality_threshold: 15,
            max_personas_per_batch: 30,
            max_feed_items: 10,
            max_response_tokens: 16000,
          },
        },
      );
      expect(resValid.structuredContent.ok).toBe(true);
      expect(resValid.structuredContent.rounds).toBe(12);

      // Out-of-bounds validations:
      // rounds > 40
      const resRoundsTooHigh = await callTool<{ isError?: boolean }>(
        harness.client,
        {
          name: "world_config",
          arguments: { rounds: 45 },
        },
      );
      expect(resRoundsTooHigh.isError).toBe(true);

      // max_feed_items < 3
      const resFeedTooLow = await callTool<{ isError?: boolean }>(
        harness.client,
        {
          name: "world_config",
          arguments: { max_feed_items: 2 },
        },
      );
      expect(resFeedTooLow.isError).toBe(true);

      // max_response_tokens < 2000
      const resTokensTooLow = await callTool<{ isError?: boolean }>(
        harness.client,
        {
          name: "world_config",
          arguments: { max_response_tokens: 1500 },
        },
      );
      expect(resTokensTooLow.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe("Tier 5: Tools 4, 5 (seed_add & seeds_review)", () => {
  it("seed_add with source:'files' prevents path traversal attacks and handles deduplication", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "File Traversal Test" },
      });

      // 1. Path traversal attack with ../
      const resTraversal = await callTool<{ structuredContent?: { seeds: Array<{ ok: boolean; error?: string }> } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "files", paths: ["../../package.json"] },
        },
      );
      expect(resTraversal.structuredContent?.seeds[0]?.ok).toBe(false);
      expect(resTraversal.structuredContent?.seeds[0]?.error).toContain("resolves outside workspace");

      // 2. Legitimate in-workspace file ingestion
      const testFile = path.join(harness.cwd, "announcement.md");
      fs.writeFileSync(testFile, "# Pricing Pivot 2026\nAll seat plans will move to consumption billing.");

      const resValidFile = await callTool<{ structuredContent: { ok: boolean; seeds: Array<{ ok: boolean; duplicate?: boolean }> } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "files", paths: ["announcement.md"] },
        },
      );
      expect(resValidFile.structuredContent.ok).toBe(true);
      expect(resValidFile.structuredContent.seeds[0].ok).toBe(true);
      expect(resValidFile.structuredContent.seeds[0].duplicate).toBe(false);

      // 3. Ingesting identical file a second time triggers duplicate: true
      const resDupFile = await callTool<{ structuredContent: { ok: boolean; seeds: Array<{ ok: boolean; duplicate?: boolean }> } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "files", paths: ["announcement.md"] },
        },
      );
      expect(resDupFile.structuredContent.seeds[0].duplicate).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("seed_add supports source:'corpus' for canonical cases and rejects invalid caseIds", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Corpus Test World" },
      });

      // 1. Valid Unity case
      const resUnity = await callTool<{ structuredContent: { ok: boolean; seed: { ref: string; title: string } } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "corpus", caseId: "unity-runtime-fee-2023" },
        },
      );
      expect(resUnity.structuredContent.ok).toBe(true);
      expect(resUnity.structuredContent.seed.ref).toBe("corpus://unity-runtime-fee-2023");
      expect(resUnity.structuredContent.seed.title).toContain("Unity");

      // 2. Valid Docker case
      const resDocker = await callTool<{ structuredContent: { ok: boolean; seed: { ref: string } } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "corpus", caseId: "docker-hub-free-team-2023" },
        },
      );
      expect(resDocker.structuredContent.ok).toBe(true);
      expect(resDocker.structuredContent.seed.ref).toBe("corpus://docker-hub-free-team-2023");

      // 3. Invalid caseId throws informative error
      const resInvalid = await callTool<{ isError?: boolean; content: Array<{ text: string }> }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "corpus", caseId: "invalid-corp-case-999" },
        },
      );
      expect(resInvalid.isError).toBe(true);
      expect(resInvalid.content[0].text).toContain("unknown corpus case");
      expect(resInvalid.content[0].text).toContain("unity-runtime-fee-2023");
    } finally {
      await harness.close();
    }
  });

  it("seed_add with source:'discourse' accepts structured threads and seeds_review lists coverage", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Discourse & Review World" },
      });

      const structuredThread = {
        platform: "reddit",
        threadId: "devops_pricing_leak",
        title: "Leaked memo indicates 40% enterprise price increase",
        author: "infra_maintainer",
        url: "https://reddit.com/r/devops/comments/devops_pricing_leak",
        timestamp: "2026-10-28T12:00:00Z",
        metrics: { upvotes: 350, comments: 85 },
        posts: [
          {
            postId: "p1",
            author: "infra_maintainer",
            text: "This sudden shift will cause budget overruns across self-hosted clusters.",
            timestamp: "2026-10-28T12:00:00Z",
            score: 180,
          },
        ],
      };

      const resDiscourse = await callTool<{ structuredContent: { ok: boolean; seed: { ref: string; title: string } } }>(
        harness.client,
        {
          name: "seed_add",
          arguments: { source: "discourse", thread: structuredThread },
        },
      );
      expect(resDiscourse.structuredContent.ok).toBe(true);
      expect(resDiscourse.structuredContent.seed.ref).toContain("devops_pricing_leak");

      // Review ingested seeds
      const resReview = await callTool<{ structuredContent: { ok: boolean; seeds: unknown[]; coverage: { seeds: number; totalBytes: number } } }>(
        harness.client,
        {
          name: "seeds_review",
          arguments: {},
        },
      );
      expect(resReview.structuredContent.ok).toBe(true);
      expect(resReview.structuredContent.seeds).toHaveLength(1);
      expect(resReview.structuredContent.coverage.seeds).toBe(1);
      expect(resReview.structuredContent.coverage.totalBytes).toBeGreaterThan(0);
      expect(TOOL_OUTPUTS.seeds_review.safeParse(resReview.structuredContent).success).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe("Tier 5: Tools 6, 7 (ontology & graph)", () => {
  it("ontology supports plan/submit with entity schema validation and idempotency", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Ontology Test World" },
      });
      await harness.client.callTool({
        name: "seed_add",
        arguments: {
          source: "text",
          title: "Policy Source",
          text: "Acme Corp announces a mandatory runtime fee for all game developers deploying on Mobile and Web.",
        },
      });

      // 1. Plan phase returns extraction task
      const planRes = await callTool<{ structuredContent: { ok: boolean; taskId: string; task: unknown } }>(
        harness.client,
        {
          name: "ontology",
          arguments: { action: "plan" },
        },
      );
      expect(planRes.structuredContent.ok).toBe(true);
      const taskId = planRes.structuredContent.taskId;
      expect(taskId).toBeDefined();

      // 2. Submit with fewer than 5 entities (< min(5)) fails Zod validation
      const invalidSubmit = await callTool<{ isError?: boolean }>(
        harness.client,
        {
          name: "ontology",
          arguments: {
            action: "submit",
            task_id: taskId,
            result: {
              entities: [
                { name: "Acme Corp", type: "org" },
              ],
            },
          },
        },
      );
      expect(invalidSubmit.isError).toBe(true);

      // 3. Submit valid 5 entities
      const validEntities = [
        { name: "Acme Corp", type: "org", salience: 0.9, motives: ["Revenue growth"], anchors: ["mandatory runtime fee"] },
        { name: "Game Developers", type: "topic", salience: 0.85, motives: ["Cost predictability"] },
        { name: "Runtime Fee", type: "product", salience: 0.95, motives: ["Monetization"] },
        { name: "OpenEngine", type: "product", salience: 0.7, motives: ["Open source alternative"] },
        { name: "Indie Studio Alliance", type: "org", salience: 0.75, motives: ["Boycott coordination"] },
      ];

      const submitRes = await callTool<{ structuredContent: { ok: boolean; inserted: number; entities: unknown[] } }>(
        harness.client,
        {
          name: "ontology",
          arguments: {
            action: "submit",
            task_id: taskId,
            result: { entities: validEntities },
          },
        },
      );
      expect(submitRes.structuredContent.ok).toBe(true);
      expect(submitRes.structuredContent.inserted).toBe(5);

      // 4. Resubmitting same task skips already-inserted entities (idempotent)
      const resubmitRes = await callTool<{ structuredContent: { ok: boolean; inserted: number } }>(
        harness.client,
        {
          name: "ontology",
          arguments: {
            action: "submit",
            task_id: taskId,
            result: { entities: validEntities },
          },
        },
      );
      expect(resubmitRes.structuredContent.ok).toBe(true);
      expect(resubmitRes.structuredContent.inserted).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("graph supports build, query, and Mermaid diagram export", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Graph Test World" },
      });
      await harness.client.callTool({
        name: "seed_add",
        arguments: {
          source: "text",
          title: "Entities Source",
          text: "Acme Corp opposes OpenEngine while Indie Studio Alliance organizes opposition against Runtime Fee.",
        },
      });
      const planRes = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "ontology",
          arguments: { action: "plan" },
        },
      );

      await harness.client.callTool({
        name: "ontology",
        arguments: {
          action: "submit",
          task_id: planRes.structuredContent.taskId,
          result: {
            entities: [
              { name: "Acme Corp", type: "org", description: "Acme Corp builds the runtime game engine", motives: ["Market control"] },
              { name: "Indie Studio Alliance", type: "org", description: "Alliance that strongly opposes Acme Corp and its runtime fee", motives: ["Fair pricing"] },
              { name: "Runtime Fee", type: "product", description: "Controversial fee policy", motives: ["Revenue capture"] },
              { name: "OpenEngine", type: "product", description: "Open source engine and rival to Acme Corp", motives: ["OSS adoption"] },
              { name: "Gaming Community", type: "topic", description: "General community", motives: ["Player rights"] },
            ],
          },
        },
      });

      // 1. graph({action: "build"})
      const buildRes = await callTool<{ structuredContent: { ok: boolean; relations: number; communities: number } }>(
        harness.client,
        {
          name: "graph",
          arguments: { action: "build" },
        },
      );
      expect(buildRes.structuredContent.ok).toBe(true);
      expect(buildRes.structuredContent.relations).toBeGreaterThanOrEqual(1);

      // 2. graph({action: "query"})
      const queryRes = await callTool<{ structuredContent: { ok: boolean; nodes: unknown[]; edges: unknown[]; tokens: number } }>(
        harness.client,
        {
          name: "graph",
          arguments: { action: "query", min_tension: 0, depth: 2, token_budget: 4000 },
        },
      );
      expect(queryRes.structuredContent.ok).toBe(true);
      expect(queryRes.structuredContent.nodes.length).toBeGreaterThan(0);

      // 3. graph({action: "export"}) writes Mermaid diagram to disk
      const exportRes = await callTool<{ structuredContent: { ok: boolean; path: string; nodeCount: number; edgeCount: number } }>(
        harness.client,
        {
          name: "graph",
          arguments: { action: "export", scope: "all" },
        },
      );
      expect(exportRes.structuredContent.ok).toBe(true);
      expect(exportRes.structuredContent.path).toContain(".mmd");

      const mmdAbsPath = path.resolve(harness.cwd, exportRes.structuredContent.path);
      expect(fs.existsSync(mmdAbsPath)).toBe(true);
      const mmdContent = fs.readFileSync(mmdAbsPath, "utf8");
      expect(mmdContent).toContain("graph LR");
    } finally {
      await harness.close();
    }
  });
});

describe("Tier 5: Tools 8, 9 (personas & sim)", () => {
  it("personas supports plan, submit, inspect card auditing, and surgical edit patches", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Personas Sim World" },
      });
      await harness.client.callTool({
        name: "seed_add",
        arguments: { source: "text", title: "Doc", text: "Acme platform policy change." },
      });
      const ontPlan = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "ontology",
          arguments: { action: "plan" },
        },
      );
      await harness.client.callTool({
        name: "ontology",
        arguments: {
          action: "submit",
          task_id: ontPlan.structuredContent.taskId,
          result: {
            entities: [
              { name: "Acme", type: "org" },
              { name: "Engineers", type: "topic" },
              { name: "Pricing", type: "product" },
              { name: "OpenSource", type: "product" },
              { name: "Investors", type: "org" },
            ],
          },
        },
      });
      await harness.client.callTool({ name: "graph", arguments: { action: "build" } });

      // 1. personas plan
      const perPlan = await callTool<{ structuredContent: { ok: boolean; taskId: string } }>(
        harness.client,
        {
          name: "personas",
          arguments: { action: "plan", count: 8 },
        },
      );
      expect(perPlan.structuredContent.ok).toBe(true);
      const taskId = perPlan.structuredContent.taskId;

      // 2. personas submit with 8 personas
      const personasDraft = Array.from({ length: 8 }, (_, i) => ({
        name: `Persona ${i + 1}`,
        handle: `@persona_${i + 1}`,
        archetype: "cautious_evaluator",
        bio: `Dev bio ${i + 1}`,
        platform: (i % 2 === 0 ? "twitter" : "reddit") as "twitter" | "reddit",
        activity: 0.6,
        stances: { Acme: i % 2 === 0 ? -0.7 : 0.2 },
      }));

      const perSubmit = await callTool<{ structuredContent: { ok: boolean; population: number; personaIds: string[] } }>(
        harness.client,
        {
          name: "personas",
          arguments: {
            action: "submit",
            task_id: taskId,
            result: { personas: personasDraft },
          },
        },
      );
      expect(perSubmit.structuredContent.ok).toBe(true);
      expect(perSubmit.structuredContent.population).toBe(8);
      const targetPersonaId = perSubmit.structuredContent.personaIds[0];

      // 3. personas inspect
      const inspectRes = await callTool<{ structuredContent: { ok: boolean; persona: { id: string; name: string }; card: { tokens: number } } }>(
        harness.client,
        {
          name: "personas",
          arguments: { action: "inspect", persona: targetPersonaId },
        },
      );
      expect(inspectRes.structuredContent.ok).toBe(true);
      expect(inspectRes.structuredContent.persona.id).toBe(targetPersonaId);
      expect(inspectRes.structuredContent.card.tokens).toBeGreaterThan(0);

      // 4. personas edit surgical patch
      const editRes = await callTool<{ structuredContent: { ok: boolean; persona: { id: string; name: string } } }>(
        harness.client,
        {
          name: "personas",
          arguments: {
            persona: targetPersonaId,
            action: "edit",
            patch: {
              name: "Senior Architect",
              bio: "Updated senior architect backstory",
            },
          },
        },
      );
      expect(editRes.structuredContent.ok).toBe(true);
      expect(editRes.structuredContent.persona.name).toBe("Senior Architect");
    } finally {
      await harness.close();
    }
  });

  it("sim drives round batching, post creation, external event injection, and timeline readouts", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Sim Full Loop World" },
      });
      await harness.client.callTool({
        name: "seed_add",
        arguments: { source: "text", title: "Doc", text: "Acme moves to telemetry billing." },
      });
      const ontPlan = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "ontology",
          arguments: { action: "plan" },
        },
      );
      await harness.client.callTool({
        name: "ontology",
        arguments: {
          action: "submit",
          task_id: ontPlan.structuredContent.taskId,
          result: {
            entities: [
              { name: "Acme", type: "org" },
              { name: "Telemetry", type: "product" },
              { name: "Developers", type: "topic" },
              { name: "Security", type: "topic" },
              { name: "Fork", type: "product" },
            ],
          },
        },
      });
      await harness.client.callTool({ name: "graph", arguments: { action: "build" } });
      const perPlan = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "personas",
          arguments: { action: "plan", count: 8 },
        },
      );

      const personasDraft = Array.from({ length: 8 }, (_, i) => ({
        name: `Dev ${i + 1}`,
        handle: `@dev_${i + 1}`,
        archetype: "cautious_evaluator",
        bio: `Bio ${i + 1}`,
        platform: "twitter" as const,
        activity: 0.8,
        stances: { Telemetry: -0.8 },
      }));
      await harness.client.callTool({
        name: "personas",
        arguments: { action: "submit", task_id: perPlan.structuredContent.taskId, result: { personas: personasDraft } },
      });

      // 1. sim next_batch
      const batchRes = await callTool<{ structuredContent: { ok: boolean; taskId: string; round: number; personas: number; task: unknown } }>(
        harness.client,
        {
          name: "sim",
          arguments: { action: "next_batch" },
        },
      );
      expect(batchRes.structuredContent.ok).toBe(true);
      const batchTaskId = batchRes.structuredContent.taskId;
      expect(batchRes.structuredContent.personas).toBeGreaterThan(0);

      // 2. sim submit generations for activated personas
      const batchTask = batchRes.structuredContent.task as { items: Array<{ id: string }> };
      const activatedPersonas = batchTask.items.map((i) => i.id.replace(/^persona-/, ""));
      const generations = activatedPersonas.slice(0, 2).map((pid) => ({
        persona: pid,
        actions: [
          { type: "post", body: "This telemetry requirement violates our compliance policy!" },
        ],
      }));

      const simSubmitRes = await callTool<{ structuredContent: { ok: boolean; round: number; advanced: boolean; postsCreated: number } }>(
        harness.client,
        {
          name: "sim",
          arguments: {
            action: "submit",
            task_id: batchTaskId,
            generations,
            finalize: true,
          },
        },
      );
      expect(simSubmitRes.structuredContent.ok).toBe(true);
      expect(simSubmitRes.structuredContent.advanced).toBe(true);
      expect(simSubmitRes.structuredContent.postsCreated).toBe(2);

      // 3. sim inject external event
      const injectRes = await callTool<{ structuredContent: { ok: boolean; eventId: string; landsInRound: number } }>(
        harness.client,
        {
          name: "sim",
          arguments: {
            action: "inject",
            text: "Open source foundation announces complete fork of telemetry suite.",
            type: "news",
            scope: "all",
          },
        },
      );
      expect(injectRes.structuredContent.ok).toBe(true);
      expect(injectRes.structuredContent.eventId).toBeDefined();

      // 4. sim summary
      const summaryRes = await callTool<{ structuredContent: { ok: boolean; stats: { round: number } } }>(
        harness.client,
        {
          name: "sim",
          arguments: { action: "summary", round: 1 },
        },
      );
      expect(summaryRes.structuredContent.ok).toBe(true);
      expect(summaryRes.structuredContent.stats.round).toBe(1);

      // 5. sim timeline
      const timelineRes = await callTool<{ structuredContent: { ok: boolean; timeline: unknown[]; rounds: number } }>(
        harness.client,
        {
          name: "sim",
          arguments: { action: "timeline" },
        },
      );
      expect(timelineRes.structuredContent.ok).toBe(true);
      expect(timelineRes.structuredContent.timeline).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

describe("Tier 5: Tools 10, 11 (report & interact)", () => {
  it("report mode:'executive' generates Minimax debate war room and exports executive deliverables", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Enterprise Executive World", description: "Per-seat to consumption pricing shift" },
      });

      // 1. report({action: "plan", mode: "executive"})
      const execPlanRes = await callTool<{ structuredContent: { ok: boolean; taskId: string; risks: string[]; hint: string } }>(
        harness.client,
        {
          name: "report",
          arguments: {
            action: "plan",
            mode: "executive",
            total_arr: 60_000_000,
            competitors: [
              { name: "Valkey", isOSS: true, featureParity: 0.9, switchingFriction: 0.3 },
              { name: "EnterpriseCluster", isOSS: false, featureParity: 0.95, switchingFriction: 0.7 },
            ],
          },
        },
      );
      expect(execPlanRes.structuredContent.ok).toBe(true);
      expect(execPlanRes.structuredContent.taskId).toContain("exec_");
      expect(execPlanRes.structuredContent.risks.length).toBeGreaterThan(0);

      // 2. report({action: "submit", mode: "executive"})
      const execSubmitRes = await callTool<{ structuredContent: { ok: boolean; version: number } }>(
        harness.client,
        {
          name: "report",
          arguments: {
            action: "submit",
            mode: "executive",
            task_id: execPlanRes.structuredContent.taskId,
          },
        },
      );
      expect(execSubmitRes.structuredContent.ok).toBe(true);
      expect(execSubmitRes.structuredContent.version).toBe(1);

      // 3. report({action: "export", mode: "executive"}) exports HTML dashboard & JSON summary
      const execExportRes = await callTool<{ structuredContent: { ok: boolean; version: number; files: Array<{ path: string; bytes: number }> } }>(
        harness.client,
        {
          name: "report",
          arguments: {
            action: "export",
            mode: "executive",
            total_arr: 60_000_000,
            competitors: [
              { name: "Valkey", isOSS: true, featureParity: 0.9, switchingFriction: 0.3 },
              { name: "EnterpriseCluster", isOSS: false, featureParity: 0.95, switchingFriction: 0.7 },
            ],
          },
        },
      );
      expect(execExportRes.structuredContent.ok).toBe(true);
      expect(execExportRes.structuredContent.files.length).toBe(2);

      const htmlEntry = execExportRes.structuredContent.files.find((f) => f.path.endsWith(".html"));
      const jsonEntry = execExportRes.structuredContent.files.find((f) => f.path.endsWith(".json"));
      expect(htmlEntry).toBeDefined();
      expect(jsonEntry).toBeDefined();

      const htmlPath = path.resolve(harness.cwd, htmlEntry!.path);
      const jsonPath = path.resolve(harness.cwd, jsonEntry!.path);
      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);

      const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      expect(jsonContent.arrRisk.grossARRAtRisk).toBeGreaterThan(0);
      expect(jsonContent.competitorMigration.length).toBe(2);
      expect(jsonContent.mediaHeadlines.length).toBe(4);
      expect(jsonContent.vaccineRewrites.length).toBe(3);
    } finally {
      await harness.close();
    }
  });

  it("interact supports grounded dialogue with persona and run evidence packs", async () => {
    const harness = await createMcpHarness();
    try {
      await harness.client.callTool({
        name: "world_init",
        arguments: { name: "Interact Dialogue World" },
      });
      await harness.client.callTool({
        name: "seed_add",
        arguments: { source: "text", title: "Doc", text: "Runtime pricing policy details." },
      });
      const ontPlan = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "ontology",
          arguments: { action: "plan" },
        },
      );
      await harness.client.callTool({
        name: "ontology",
        arguments: {
          action: "submit",
          task_id: ontPlan.structuredContent.taskId,
          result: {
            entities: [
              { name: "Acme", type: "org" },
              { name: "Engine", type: "product" },
              { name: "Studios", type: "topic" },
              { name: "Fees", type: "product" },
              { name: "Community", type: "topic" },
            ],
          },
        },
      });
      await harness.client.callTool({ name: "graph", arguments: { action: "build" } });
      const perPlan = await callTool<{ structuredContent: { taskId: string } }>(
        harness.client,
        {
          name: "personas",
          arguments: { action: "plan", count: 8 },
        },
      );
      const perSubmit = await callTool<{ structuredContent: { personaIds: string[] } }>(
        harness.client,
        {
          name: "personas",
          arguments: {
            action: "submit",
            task_id: perPlan.structuredContent.taskId,
            result: {
              personas: Array.from({ length: 8 }, (_, i) => ({
                name: `Developer ${i + 1}`,
                handle: `@dev_${i + 1}`,
                archetype: "cautious_evaluator",
                bio: `Dev bio ${i + 1}`,
                platform: "twitter" as const,
                activity: 0.5,
                stances: { Engine: -0.7 },
              })),
            },
          },
        },
      );

      const targetPid = perSubmit.structuredContent.personaIds[0];

      // 1. interact({target: 'persona'}) without answer returns grounded pack
      const packRes = await callTool<{ structuredContent: { ok: boolean; pack: { question: string; persona: unknown } } }>(
        harness.client,
        {
          name: "interact",
          arguments: {
            target: "persona",
            persona: targetPid,
            question: "How does the new fee structure impact your studio's margin?",
          },
        },
      );
      expect(packRes.structuredContent.ok).toBe(true);
      expect(packRes.structuredContent.pack.question).toContain("impact your studio");
      expect(packRes.structuredContent.pack.persona).toBeDefined();

      // 2. interact({target: 'persona'}) with answer logs dialogue
      const logRes = await callTool<{ structuredContent: { ok: boolean; logged: boolean; file: string } }>(
        harness.client,
        {
          name: "interact",
          arguments: {
            target: "persona",
            persona: targetPid,
            question: "How does the new fee structure impact your studio's margin?",
            answer: "It reduces our net margin by 12% on iOS installs.",
          },
        },
      );
      expect(logRes.structuredContent.ok).toBe(true);
      expect(logRes.structuredContent.logged).toBe(true);
      expect(logRes.structuredContent.file).toContain("interviews");

      const interviewLogPath = path.resolve(harness.cwd, logRes.structuredContent.file);
      expect(fs.existsSync(interviewLogPath)).toBe(true);
      const lines = fs.readFileSync(interviewLogPath, "utf8").trim().split("\n");
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.answer).toContain("reduces our net margin");

      // 3. interact({target: 'run'}) returns global evidence pack
      const runPackRes = await callTool<{ structuredContent: { ok: boolean; pack: { question: string } } }>(
        harness.client,
        {
          name: "interact",
          arguments: {
            target: "run",
            question: "What was the aggregate reaction across all developer cohorts?",
          },
        },
      );
      expect(runPackRes.structuredContent.ok).toBe(true);
      expect(runPackRes.structuredContent.pack.question).toContain("aggregate reaction");
    } finally {
      await harness.close();
    }
  });
});
