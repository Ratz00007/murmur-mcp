/**
 * Macro engine tool: macro_sim — runs the vectorized 100k-node SEICR graph
 * dynamics (createMacroGraphState / stepMacroGraph) and persists a snapshot per
 * round into macro_snapshots, returning a compact per-round summary.
 *
 * This is the production caller for the previously-dead macro engine
 * (packages/engine/src/dynamics/macro-graph.ts). Zero LLM tokens: every round
 * is deterministic CSR TypedArray math.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createMacroGraphState,
  injectSemanticShockwave,
  saveMacroSnapshot,
  stepMacroGraph,
  type SemanticShockwave,
} from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { MACRO_SIM_OUTPUT } from "./outputs.js";

export const MACRO_TOOL_NAMES = ["macro_sim"] as const;

const DEFAULT_NODE_COUNT = 1000;
const MAX_NODE_COUNT = 100_000;
const DEFAULT_AVERAGE_DEGREE = 8;
const DEFAULT_ROUNDS = 1;
const MAX_ROUNDS = 20;

const shockwaveSchema = z.object({
  nodes: z
    .array(z.number().int().min(0).max(MAX_NODE_COUNT - 1))
    .min(1)
    .describe("Node indices to seed with the shockwave"),
  stanceShift: z
    .number()
    .describe("Signed stance delta applied to each target node (clamped to [-1, 1])"),
  deltaOutrage: z
    .number()
    .describe("Outrage delta applied to each target node (clamped to [0, 1])"),
  makeContagious: z
    .boolean()
    .optional()
    .describe("Force target nodes into the contagious compartment (default true)"),
});

export function registerMacroTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "macro_sim",
    {
      title: "Run the vectorized macro graph engine (100k+ nodes)",
      description:
        "Builds a CSR macro graph (node_count nodes, average_degree directed edges per node) and steps " +
        "SEICR dynamics for `rounds` rounds — zero LLM tokens, deterministic, sub-second on 100k nodes. " +
        "Optionally injects a semantic shockwave (nodes + stanceShift + deltaOutrage + makeContagious) " +
        "before the first round. Every round's state is persisted to macro_snapshots (saveMacroSnapshot) " +
        "and reloadable later. Returns a compact per-round summary: nodeCount, edgeCount, compartment " +
        "distribution, mean stance, outrage index, contagion, durationMs.",
      inputSchema: {
        world: z
          .string()
          .optional()
          .describe("World id/slug (default: active world)"),
        node_count: z
          .number()
          .int()
          .min(1)
          .max(MAX_NODE_COUNT)
          .optional()
          .describe(`Population size (default ${DEFAULT_NODE_COUNT}, max ${MAX_NODE_COUNT})`),
        average_degree: z
          .number()
          .int()
          .min(1)
          .max(1024)
          .optional()
          .describe(`Directed edges per node (default ${DEFAULT_AVERAGE_DEGREE})`),
        rounds: z
          .number()
          .int()
          .min(1)
          .max(MAX_ROUNDS)
          .optional()
          .describe(`Simulation rounds (default ${DEFAULT_ROUNDS}, max ${MAX_ROUNDS})`),
        shockwave: shockwaveSchema
          .optional()
          .describe("Optional event shockwave applied to target nodes before the first round"),
      },
      outputSchema: MACRO_SIM_OUTPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const w = ctx.resolveWorld(args.world);
        const nodeCount = args.node_count ?? DEFAULT_NODE_COUNT;
        const averageDegree = args.average_degree ?? DEFAULT_AVERAGE_DEGREE;
        const rounds = args.rounds ?? DEFAULT_ROUNDS;

        const state = createMacroGraphState({ nodeCount, averageDegree });

        if (args.shockwave && args.shockwave.nodes.length > 0) {
          const shock: SemanticShockwave = {
            targetSeedIndices: args.shockwave.nodes,
            stanceShift: args.shockwave.stanceShift,
            deltaOutrage: args.shockwave.deltaOutrage,
            makeContagious: args.shockwave.makeContagious ?? true,
          };
          injectSemanticShockwave(state, shock);
        }

        const summaries: Array<Record<string, unknown>> = [];
        for (let round = 1; round <= rounds; round++) {
          const stepResult = stepMacroGraph(state, { round });
          saveMacroSnapshot(ctx.storage.db, w.id, round, state, stepResult);
          summaries.push({
            round,
            nodeCount: state.nodeCount,
            edgeCount: state.edgeCount,
            distribution: stepResult.stateDistribution,
            meanStance: stepResult.meanStance,
            outrageIndex: stepResult.outrageIndex,
            contagion: stepResult.stateDistribution.contagious,
            durationMs: Math.round(stepResult.durationMs * 100) / 100,
          });
        }

        ctx.audit(w, {
          op: "macro_sim",
          world: w.id,
          nodeCount,
          averageDegree,
          rounds,
          shockwaveSeeds: args.shockwave ? args.shockwave.nodes.length : 0,
        });

        return ctx.reply(
          {
            ok: true,
            world: w.id,
            nodeCount,
            averageDegree,
            rounds,
            summaries,
            next:
              'report({action:"plan", mode:"executive", macro_sim: <this summary>}) to fold the macro outrage into the executive report',
          },
          w,
          MACRO_SIM_OUTPUT,
        );
      } catch (e) {
        return ctx.fail(e);
      }
    },
  );
}
