/** Graph tools: graph_build, graph_query, graph_export_mermaid. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildGraph, graphQuery, toMermaid } from "@murmur/engine";
import type { ServerContext } from "../session.js";

export function registerGraphTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "graph_build",
    "Stage 3: derive typed relations (alliance, opposition, influence, ownership) with tension scores from the ontology, and build " +
      "reddit-style communities. Deterministic — no LLM needed for this step.",
    { world: z.string().optional().describe("World id/slug (default: active world)") },
    async ({ world }) => {
      try {
        const w = ctx.resolveWorld(world);
        const out = buildGraph(ctx.storage, w);
        const relations = ctx.storage.listRelations(w.id);
        const top = relations
          .filter((r) => r.tension > 0.5)
          .slice(0, 8)
          .map((r) => {
            const entities = ctx.storage.listEntities(w.id);
            const name = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
            return `${name(r.srcId)} —${r.type}→ ${name(r.dstId)} (tension ${r.tension})`;
          });
        ctx.audit(w, { op: "graph_build", ...out });
        return ctx.reply(
          {
            ok: true,
            relations: out.relations,
            tensionsAbove05: out.tensions,
            communities: out.communities,
            topTensions: top,
            next: "personas_plan to draft the population",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "graph_query",
    "Traverse the relation graph: by anchor entity (1-3 hops), relation type, or minimum tension. Responses are token-budgeted (default 4,000).",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      anchor: z.string().optional().describe("Entity name or id to start from"),
      relation: z.enum(["alliance", "opposition", "influence", "ownership"]).optional(),
      min_tension: z.number().min(0).max(1).optional().describe("Only edges at/above this tension (0-1)"),
      depth: z.number().int().min(1).max(3).optional().describe("Hops from anchor (default 1)"),
      token_budget: z.number().int().min(500).max(8000).optional().describe("Response budget (default 4000)"),
    },
    async (args) => {
      try {
        const w = ctx.resolveWorld(args.world);
        const result = graphQuery(ctx.storage, w, {
          anchor: args.anchor,
          relation: args.relation,
          minTension: args.min_tension,
          depth: args.depth,
          tokenBudget: args.token_budget,
        });
        return ctx.reply({ ok: true, ...result, next: "graph_export_mermaid to save a viewable diagram, or personas_plan" }, w);
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );

  server.tool(
    "graph_export_mermaid",
    "Write the graph (or its hottest sub-graph) as a Mermaid diagram into the world directory — viewable on any git forge.",
    {
      world: z.string().optional().describe("World id/slug (default: active world)"),
      scope: z.enum(["all", "hot"]).optional().describe("'hot' = only high-tension relations (default all)"),
    },
    async ({ world, scope }) => {
      try {
        const w = ctx.resolveWorld(world);
        const result = graphQuery(ctx.storage, w, {
          minTension: scope === "hot" ? 0.5 : 0,
          tokenBudget: 8000,
        });
        const mermaid = toMermaid(result);
        const file = ctx.workspace.graphPath(w.slug);
        ctx.workspace.writeAtomic(file, mermaid);
        ctx.audit(w, { op: "graph_export_mermaid", scope: scope ?? "all" });
        return ctx.reply(
          {
            ok: true,
            path: ctx.workspace.rel(file),
            nodes: result.nodes.length,
            edges: result.edges.length,
            next: "personas_plan to draft the population",
          },
          w
        );
      } catch (e) {
        return ctx.fail(e);
      }
    }
  );
}
