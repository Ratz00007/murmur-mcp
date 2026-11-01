/**
 * The tool surface is the API. These tests are the tripwire for it.
 *
 * `TOOL_COUNT` used to be a bare literal in tools/index.ts that nothing checked:
 * it drifted silently, and the advertised count in the server instructions and
 * the README was a number no code path could contradict. It is now asserted
 * three ways — a startup assertion (assertToolSurface), this test, and the e2e
 * which reads the count the live server reports over the wire.
 *
 * The second half of the file checks the other half of the protocol contract:
 * every tool declares an outputSchema, and every reply that carries
 * `structuredContent` validates against it. The spill receipt is the case that
 * used to be unhandled — `ServerContext.reply` replaces an oversized payload
 * with a differently-shaped object, and a schema whose required fields the
 * receipt cannot carry would make the SDK reject a correct answer.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, SERVER_INSTRUCTIONS } from "../../src/server.js";
import { ServerContext } from "../../src/session.js";
import {
  MIGRATED_TOOLS,
  MODULE_TOOL_NAMES,
  TOOL_COUNT,
  TOOL_NAMES,
  assertToolSurface,
} from "./index.js";
import { TOOL_OUTPUTS } from "./outputs.js";

/** The 29 names the server exposed before the surface was consolidated. */
const PRE_CONSOLIDATION_TOOLS = [
  "world_init",
  "world_list",
  "world_open",
  "world_status",
  "world_config",
  "sim_configure",
  "seed_add_files",
  "seed_add_url",
  "seed_add_text",
  "seeds_review",
  "ontology_plan",
  "ontology_submit",
  "graph_build",
  "graph_query",
  "graph_export_mermaid",
  "personas_plan",
  "personas_submit",
  "persona_inspect",
  "persona_edit",
  "sim_next_batch",
  "sim_submit_generations",
  "sim_inject_event",
  "sim_round_summary",
  "sim_timeline",
  "report_plan",
  "report_submit",
  "report_export",
  "interview_agent",
  "report_agent_ask",
];

/** The oversize receipt `ServerContext.reply` substitutes for a big payload. */
const SPILL_RECEIPT = {
  ok: true,
  spilled: true as const,
  reason: "payload exceeded the response token budget",
  artifact: ".murmur/oversize-x.json",
  fullTokens: 48210,
  next: "read the artifact file for the full payload, then continue",
};

describe("tool surface", () => {
  it("declares exactly TOOL_COUNT tools, with no duplicates", () => {
    expect(TOOL_COUNT).toBe(12);
    expect(TOOL_NAMES).toHaveLength(TOOL_COUNT);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_COUNT);
  });

  it("keeps the modules and the declared list in agreement", () => {
    expect(() => assertToolSurface()).not.toThrow();
    const fromModules = Object.values(MODULE_TOOL_NAMES).flat();
    expect(fromModules.sort()).toEqual([...TOOL_NAMES].sort());
    expect(Object.keys(MODULE_TOOL_NAMES)).toHaveLength(9);
  });

  it("fails the assertion when a module and the declared list disagree", () => {
    const drifted = {
      ...MODULE_TOOL_NAMES,
      world: [...WORLD_TOOL_NAMES_FOR_TEST, "world_teleport"],
    };
    const original = MODULE_TOOL_NAMES.world;
    try {
      (MODULE_TOOL_NAMES as Record<string, readonly string[]>).world =
        drifted.world;
      expect(() => assertToolSurface()).toThrow(/world_teleport/);
    } finally {
      (MODULE_TOOL_NAMES as Record<string, readonly string[]>).world = original;
    }
  });

  it("accounts for every pre-consolidation tool name in the migration map", () => {
    expect(PRE_CONSOLIDATION_TOOLS).toHaveLength(29);
    for (const oldName of PRE_CONSOLIDATION_TOOLS) {
      expect(
        MIGRATED_TOOLS[oldName],
        `${oldName} has no migration entry`,
      ).toBeTruthy();
      // The mapped value must name a tool that actually exists.
      const target = MIGRATED_TOOLS[oldName].split(/[\s({]/)[0];
      expect(TOOL_NAMES, `${oldName} maps to unknown tool ${target}`).toContain(
        target,
      );
    }
    // No orphan entries: the map is about the old surface, nothing more.
    expect(Object.keys(MIGRATED_TOOLS).sort()).toEqual(
      [...PRE_CONSOLIDATION_TOOLS].sort(),
    );
  });

  it("never names a retired tool in the server instructions", () => {
    // A tool is retired when its migration target is a DIFFERENT name. Four of
    // the 29 pre-consolidation names survive verbatim (world_init, world_list,
    // world_config, seeds_review), so the retired count is 25, not 29-11: the
    // naive subtraction only holds if no old name survives and no new name is
    // invented, and the consolidation did both.
    const retired = PRE_CONSOLIDATION_TOOLS.filter((n) => {
      const target = MIGRATED_TOOLS[n].split(/[\s({]/)[0];
      return target !== n;
    });
    expect(retired).toHaveLength(25);
    for (const oldName of retired) {
      expect(
        SERVER_INSTRUCTIONS,
        `instructions still mention ${oldName}`,
      ).not.toContain(oldName);
    }
    for (const name of TOOL_NAMES) {
      expect(
        SERVER_INSTRUCTIONS,
        `instructions never mention ${name}`,
      ).toContain(name);
    }
  });
});

describe("output schemas", () => {
  it("declares one for every tool, and none for a tool that does not exist", () => {
    expect(Object.keys(TOOL_OUTPUTS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("requires ok and next — the invariant that survives the spill path", () => {
    for (const [name, schema] of Object.entries(TOOL_OUTPUTS)) {
      const required = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const field of ["ok", "next"] as const) {
        expect(required[field], `${name}.${field} must exist`).toBeDefined();
        expect(
          required[field].isOptional(),
          `${name}.${field} must be required`,
        ).toBe(false);
      }
    }
  });

  it("accepts the oversize spill receipt on every tool", () => {
    for (const [name, schema] of Object.entries(TOOL_OUTPUTS)) {
      const parsed = (schema as z.ZodTypeAny).safeParse(SPILL_RECEIPT);
      expect(
        parsed.success,
        `${name} rejects the spill receipt: ${parsed.success ? "" : parsed.error.message}`,
      ).toBe(true);
    }
  });

  it("still rejects a payload that is missing the envelope", () => {
    for (const [name, schema] of Object.entries(TOOL_OUTPUTS)) {
      const parsed = (schema as z.ZodTypeAny).safeParse({
        somethingElse: true,
      });
      expect(parsed.success, `${name} accepts a payload with no ok/next`).toBe(
        false,
      );
    }
  });
});

describe("the live server", () => {
  it("registers exactly TOOL_COUNT tools, each with an outputSchema", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-surface-"));
    fs.mkdirSync(path.join(cwd, ".murmur"), { recursive: true });
    process.env.MURMUR_WORKSPACE = cwd;
    const ctx = new ServerContext(cwd);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "surface-test", version: "0.0.0" });
    try {
      await buildServer(ctx).connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      expect(tools).toHaveLength(TOOL_COUNT);
      for (const tool of tools) {
        expect(
          tool.outputSchema,
          `${tool.name} declares no outputSchema`,
        ).toBeDefined();
        expect(
          tool.inputSchema,
          `${tool.name} declares no inputSchema`,
        ).toBeDefined();
        // A schema that is not an object cannot describe structuredContent.
        expect(
          (tool.outputSchema as { type?: string }).type,
          `${tool.name} outputSchema is not an object schema`,
        ).toBe("object");
        expect(
          tool.description,
          `${tool.name} has no description`,
        ).toBeTruthy();
      }

      // And the four generation stages advertise task support.
      for (const name of ["ontology", "personas", "sim", "report"]) {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool.execution?.taskSupport, `${name} is not task-capable`).toBe(
          "optional",
        );
      }

      // A real call must return structuredContent that validates.
      const res = await client.callTool({
        name: "world_init",
        arguments: { name: "surface-probe" },
      });
      expect(res.isError).toBeFalsy();
      expect(
        res.structuredContent,
        "world_init returned no structuredContent",
      ).toBeTruthy();
      expect(
        TOOL_OUTPUTS.world_init.safeParse(res.structuredContent).success,
      ).toBe(true);
      // …and the same JSON as the text block, for clients without structured output.
      expect(JSON.stringify(res.structuredContent)).toBe(
        (res.content as { text: string }[])[0].text,
      );
    } finally {
      await client.close().catch(() => {});
      ctx.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/** Snapshot of the world module's names, so the drift test can perturb it. */
const WORLD_TOOL_NAMES_FOR_TEST = MODULE_TOOL_NAMES.world;
