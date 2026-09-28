/** Server assembly: McpServer + tools + resources + prompts + sampling bridge. */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./session.js";
import { log } from "./logging.js";
import { registerTools, TOOL_COUNT } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export const SERVER_NAME = "murmur-mcp";

// Read the version from the package.json that ships next to this file (both
// src/ and dist/ sit one level below the package root), so the CLI, the MCP
// handshake and npm can never disagree. Falls back loudly if unresolvable.
function readVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    /* fall through */
  }
  return "0.0.0";
}
export const SERVER_VERSION = readVersion();

export const SERVER_INSTRUCTIONS =
  "Murmur rehearses how a community reacts to a change with a strictly ordered 7-stage pipeline: " +
  "world_init → seeds (seed_add_files / seed_add_url / seed_add_text, then seeds_review) → ontology_plan → ontology_submit → " +
  "graph_build → personas_plan → personas_submit → sim_configure → the simulation loop (sim_next_batch → sim_submit_generations × N rounds) → " +
  "report_plan → report_submit → report_export → interviews (interview_agent / report_agent_ask). " +
  "Call the /murmur-predict prompt for the full one-command playbook, or world_status to see exactly where a world stands. " +
  "Never skip stages and never redo completed ones: every receipt names the next tool to call, and every plan receipt carries the " +
  "task schema to complete yourself before submitting it.";

export function buildServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);

  // Optional accelerator: MCP sampling, when the client supports it.
  // Plan/submit remains the universal default path on every client. Sampling
  // is a method on the low-level Server (reachable as `server.server` in the
  // SDK's McpServer), not a property — probe for createMessage explicitly.
  //
  // It must be BOUND. `createMessage` is a prototype method that reads
  // `this._clientCapabilities`; extracting it into a bare const and calling it
  // unbound sets `this` to undefined, so every call threw a TypeError that the
  // catch below swallowed into a one-time warning. The probe succeeded, which
  // is exactly what hid the bug: `use_sampling: true` silently no-opped and
  // the whole `fillViaSampling` path was unreachable.
  const lowLevel = (server as unknown as { server?: { createMessage?: unknown } }).server;
  if (typeof lowLevel?.createMessage === "function") {
    const createMessage = (
      lowLevel.createMessage as (this: unknown, req: unknown, opts?: unknown) => Promise<{ content?: { type: string; text?: string } }>
    ).bind(lowLevel);
    log.info("sampling bridge: client sampling reachable via Server.createMessage (bound)");
    let warned = false;
    ctx.sampling = async (prompt, system, maxTokens) => {
      try {
        const result = await createMessage(
          {
            messages: [{ role: "user", content: { type: "text", text: prompt } }],
            systemPrompt: system,
            maxTokens,
          },
          {}
        );
        return result?.content?.type === "text" ? (result.content.text ?? null) : null;
      } catch (e) {
        if (!warned) {
          warned = true;
          log.warn(`sampling bridge declined by client (${String(e)}) — plan/submit remains the default path`);
        }
        return null;
      }
    };
  } else {
    log.warn("sampling bridge unavailable: Server.createMessage not found on the SDK's low-level server");
  }

  return server;
}

export { TOOL_COUNT };
