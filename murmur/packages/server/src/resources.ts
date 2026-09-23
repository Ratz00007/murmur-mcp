/** MCP resources: murmur://worlds, murmur://world/{id}/state, murmur://world/{id}/report/{rid}. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderReportMarkdown, worldListRow, worldStatus } from "@murmur/engine";
import type { ServerContext } from "./session.js";

export function registerResources(server: McpServer, ctx: ServerContext): void {
  server.resource(
    "worlds",
    "murmur://worlds",
    { description: "Index of every world in this workspace" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ worlds: ctx.storage.listWorlds().map((w) => worldListRow(ctx.storage, w)) }),
        },
      ],
    })
  );

  server.resource(
    "world-state",
    new ResourceTemplate("murmur://world/{id}/state", {
      list: async () => ({
        resources: ctx.storage.listWorlds().map((w) => ({
          uri: `murmur://world/${w.id}/state`,
          name: `${w.name} — state`,
          mimeType: "application/json",
          description: `stage ${w.stage}, round ${w.round}/${w.config.rounds}`,
        })),
      }),
    }),
    { description: "Live state of a world: stage, round, counts, sentiment snapshot" },
    async (uri, { id }) => {
      try {
        const world = ctx.resolveWorld(String(id));
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(worldStatus(ctx.storage, world)) }],
        };
      } catch (e) {
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: String(e) }) }] };
      }
    }
  );

  server.resource(
    "report",
    new ResourceTemplate("murmur://world/{id}/report/{rid}", {
      list: async () => {
        const out = [];
        for (const w of ctx.storage.listWorlds()) {
          const latest = ctx.storage.latestReport(w.id);
          if (latest) {
            out.push({
              uri: `murmur://world/${w.id}/report/${latest.version}`,
              name: `${w.name} — report v${latest.version}`,
              mimeType: "text/markdown",
            });
          }
        }
        return { resources: out };
      },
    }),
    { description: "Rendered prediction report (Markdown)" },
    async (uri, { id, rid }) => {
      try {
        const world = ctx.resolveWorld(String(id));
        const version = Number(rid) || undefined;
        const record = version ? ctx.storage.reportByVersion(world.id, version) : ctx.storage.latestReport(world.id);
        if (!record) throw new Error("no report stored for this world");
        return {
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderReportMarkdown(ctx.storage, world, record) }],
        };
      } catch (e) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: String(e) }] };
      }
    }
  );
}
