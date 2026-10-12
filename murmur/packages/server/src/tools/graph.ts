/**
 * Stage 3 — graph: one tool over one relation graph.
 *
 * `build`, `query` and `export` are three views of the same derived structure,
 * so they are three actions of one tool rather than three catalog entries.
 * `build` is deterministic and idempotent (it re-derives and replaces the edge
 * set), `query` and `export` only read it.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildGraph, graphQuery, toMermaid } from "@murmur/engine";
import type { ServerContext } from "../session.js";
import { GRAPH_OUTPUT } from "./outputs.js";

export const GRAPH_TOOL_NAMES = ["graph"] as const;

export function registerGraphTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "graph",
    {
      title: "Build / traverse / render the relation graph",
      description:
        "Stage 3 of the pipeline. action:'build' derives typed relations (alliance, opposition, influence, ownership) " +
        "with tension scores from the ontology and detects reddit-style communities — deterministic, no LLM needed. " +
        "action:'query' traverses the built graph by anchor entity (1-3 hops), relation type or minimum tension, " +
        "token-budgeted. action:'export' writes the graph (or its hottest sub-graph) as a Mermaid diagram into the world " +
        "directory, viewable on any git forge.",
      inputSchema: {
        action: z.enum(["build", "query", "export"]).describe("Build the graph, traverse it, or write it to disk"),
        world: z.string().optional().describe("World id/slug (default: active world)"),
        anchor: z.string().optional().describe("Entity name or id to start from — action:'query'"),
        relation: z.enum(["alliance", "opposition", "influence", "ownership"]).optional().describe("Edge type filter — action:'query'"),
        min_tension: z.number().min(0).max(1).optional().describe("Only edges at/above this tension (0-1) — action:'query'/'export'"),
        depth: z.number().int().min(1).max(3).optional().describe("Hops from the anchor (default 1) — action:'query'"),
        token_budget: z.number().int().min(500).max(8000).optional().describe("Traversal budget in tokens (default 4000) — action:'query'"),
        scope: z.enum(["all", "hot"]).optional().describe("'hot' = only high-tension relations — action:'export'"),
      },
      outputSchema: GRAPH_OUTPUT,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ action, world, anchor, relation, min_tension, depth, token_budget, scope }) => {
      try {
        const w = ctx.resolveWorld(world);
        if (action === "build") {
          const out = buildGraph(ctx.storage, w);
          const relations = ctx.storage.listRelations(w.id);
          const entities = ctx.storage.listEntities(w.id);
          const name = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
          const top = relations
            .filter((r) => r.tension > 0.5)
            .slice(0, 8)
            .map((r) => `${name(r.srcId)} —${r.type}→ ${name(r.dstId)} (tension ${r.tension})`);
          ctx.audit(w, { op: "graph_build", ...out });
          return ctx.reply(
            {
              ok: true,
              relations: out.relations,
              tensionsAbove05: out.tensions,
              communities: out.communities,
              topTensions: top,
              next: 'personas({action:"plan"}) to draft the population',
            },
            w,
            GRAPH_OUTPUT
          );
        }
        if (action === "export") {
          const result = graphQuery(ctx.storage, w, {
            minTension: scope === "hot" ? 0.5 : 0,
            tokenBudget: 8000,
          });
          const file = ctx.workspace.graphPath(w.slug);
          ctx.workspace.writeAtomic(file, toMermaid(result));
          ctx.audit(w, { op: "graph_export", scope: scope ?? "all" });
          return ctx.reply(
            {
              ok: true,
              path: ctx.workspace.rel(file),
              // Counts, not the arrays `action:"query"` returns under the same
              // two names — a receipt that reported 400 nodes in full would
              // blow the response budget for no gain.
              nodeCount: result.nodes.length,
              edgeCount: result.edges.length,
              next: 'personas({action:"plan"}) to draft the population',
            },
            w,
            GRAPH_OUTPUT
          );
        }
        const result = graphQuery(ctx.storage, w, {
          anchor,
          relation,
          minTension: min_tension,
          depth,
          tokenBudget: token_budget,
        });
        return ctx.reply(
          {
            ok: true,
            nodes: result.nodes,
            edges: result.edges,
            tokens: result.tokens,
            truncated: result.truncated,
            next: 'graph({action:"export"}) to save a viewable diagram, or personas({action:"plan"})',
          },
          w,
          GRAPH_OUTPUT
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}
