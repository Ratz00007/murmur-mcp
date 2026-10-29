/**
 * MCP resources: murmur://worlds, murmur://world/{id}/state,
 * murmur://world/{id}/report/{rid} — with completions for both template
 * variables, so a client can autocomplete `murmur://world/<TAB>` and the
 * report version inside a filled-in template.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  renderReportMarkdown,
  worldListRow,
  worldStatus,
} from "@murmur/engine";
import { log } from "./logging.js";
import type { ServerContext } from "./session.js";

/**
 * `ErrorCode` is not deprecated in @modelcontextprotocol/sdk 1.30.0 — the enum
 * is the only way to attach a JSON-RPC code to an error, and the zod schemas
 * in `types.js` parse *responses*, they do not build them. What did change is
 * the code itself: the 2026-07-28 spec moved "resource not found" off the
 * implementation-defined -32002 onto JSON-RPC's Invalid Params (-32602), so a
 * bad `{id}`/`{rid}` is reported as `InvalidParams` rather than as
 * `InternalError` ("the server broke"), which is what it was before and never
 * was.
 */
const NOT_FOUND = ErrorCode.InvalidParams;

export function registerResources(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    "worlds",
    "murmur://worlds",
    { description: "Index of every world in this workspace" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            worlds: ctx.storage
              .listWorlds()
              .map((w) => worldListRow(ctx.storage, w)),
          }),
        },
      ],
    }),
  );

  server.registerResource(
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
      complete: {
        // Both the id and the human-facing slug resolve, so a client can offer
        // whichever the user is more likely to type.
        id: async (value) => {
          const prefix = value.toLowerCase();
          return ctx.storage
            .listWorlds()
            .flatMap((w) => [w.id, w.slug])
            .filter((candidate) => candidate.toLowerCase().startsWith(prefix))
            .slice(0, 50);
        },
      },
    }),
    {
      description:
        "Live state of a world: stage, round, counts, sentiment snapshot",
    },
    async (uri, { id }) => {
      try {
        const world = ctx.resolveWorld(String(id));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(worldStatus(ctx.storage, world)),
            },
          ],
        };
      } catch (e) {
        // Error signaling, not data: a failed read surfaces as a JSON-RPC
        // error so hosts can distinguish failure from a payload.
        const message = e instanceof Error ? e.message : String(e);
        log.warn(`resource read failed (world state): ${message}`);
        throw new McpError(NOT_FOUND, message);
      }
    },
  );

  server.registerResource(
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
      complete: {
        id: async (value) => {
          const prefix = value.toLowerCase();
          return ctx.storage
            .listWorlds()
            .filter((w) => ctx.storage.latestReport(w.id))
            .flatMap((w) => [w.id, w.slug])
            .filter((candidate) => candidate.toLowerCase().startsWith(prefix))
            .slice(0, 50);
        },
        // Report versions are per-world, so the world named earlier in the
        // same template has to be read out of the completion context. Versions
        // are sequential from 1, so the latest one bounds the scan.
        rid: async (value, context) => {
          const id = context?.arguments?.id;
          const world = id ? ctx.storage.getWorld(id) : null;
          if (!world) return [];
          const latest = ctx.storage.latestReport(world.id);
          if (!latest) return [];
          const prefix = value.trim();
          const versions: string[] = [];
          for (let v = latest.version; v >= 1; v--) {
            if (
              ctx.storage.reportByVersion(world.id, v) &&
              (!prefix || String(v).startsWith(prefix))
            ) {
              versions.push(String(v));
            }
          }
          return versions;
        },
      },
    }),
    { description: "Rendered prediction report (Markdown)" },
    async (uri, { id, rid }) => {
      try {
        const world = ctx.resolveWorld(String(id));
        const version = Number(rid) || undefined;
        const record = version
          ? ctx.storage.reportByVersion(world.id, version)
          : ctx.storage.latestReport(world.id);
        if (!record) throw new Error("no report stored for this world");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: renderReportMarkdown(ctx.storage, world, record),
            },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn(`resource read failed (report): ${message}`);
        throw new McpError(NOT_FOUND, message);
      }
    },
  );
}
