/** Server assembly: McpServer + tools + resources + prompts + sampling bridge. */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import type { ServerContext } from "./session.js";
import { log, setMcpLogSink } from "./logging.js";
import { registerTools, TOOL_COUNT } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export const SERVER_NAME = "murmur-mcp";

// Read the version from the package.json that ships next to this file (both
// src/ and dist/ sit one level below the package root), so the CLI, the MCP
// handshake and npm can never disagree. Falls back loudly if unresolvable.
function readVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    /* fall through */
  }
  return "0.0.0";
}
export const SERVER_VERSION = readVersion();

export const SERVER_INSTRUCTIONS =
  "Murmur rehearses how a community reacts to a change with a strictly ordered 7-stage pipeline over 12 tools. " +
  "Each stage is one tool with an `action` (or `target`) argument: " +
  '1) world_init → 2) seed_add({source:"files"|"url"|"text"}) then seeds_review → 3) ontology({action:"plan"}) → ontology({action:"submit"}) → ' +
  '4) graph({action:"build"}) → 5) personas({action:"plan"}) → personas({action:"submit"}) → 6) world_config → ' +
  'the simulation loop (sim({action:"next_batch"}) → sim({action:"submit"}) × N rounds, with sim({action:"inject"}) between rounds) → ' +
  'macro_sim ({node_count, rounds, shockwave?}) runs the vectorized 100k-node macro engine — SEICR compartments, outrage index, per-round snapshots — → ' +
  '7) report({action:"plan"}) → report({action:"submit"}) → report({action:"export"}) → 8) interact({target:"persona"|"run"}). ' +
  "world_list is the only navigation tool: detail:'rows' lists worlds, detail:'open' makes one active, detail:'status' reads " +
  "the full session readout. Every tool declares an outputSchema, and its structuredContent is the same JSON as its text block. " +
  "Call the /murmur-predict prompt for the full one-command playbook. " +
  "Never skip stages and never redo completed ones: every receipt names the next tool call to make, and every plan receipt " +
  "carries the task schema to complete yourself before submitting it.";

export function buildServer(ctx: ServerContext): McpServer {
  // The task store is what makes `execution.taskSupport: "optional"` real on
  // the four generation stages (see tools/tasks.ts). Without it the SDK has
  // nowhere to put a task result and the tools would have to drop the
  // affordance entirely.
  const taskStore = new InMemoryTaskStore();
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS, taskStore },
  );

  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);

  // Logging over MCP: mirror warn-and-above to the client via
  // notifications/message. Stderr remains the primary sink — the mirror is
  // best-effort and a client that never asked for logging ignores it.
  setMcpLogSink((level, message) =>
    server.sendLoggingMessage({ level, data: message }),
  );

  // The low-level Server carries the client-facing methods (createMessage for
  // sampling, elicitInput for elicitation) as prototype methods. Both bridges
  // below probe explicitly and BIND — calling either unbound sets `this` to
  // undefined and fails on client capabilities, which a catch would swallow.
  const lowLevel = (
    server as unknown as {
      server?: { createMessage?: unknown; elicitInput?: unknown };
    }
  ).server;

  // Elicitation bridge: let tools ask the user for a missing value instead of
  // failing outright, when the client supports it. Every caller falls back to
  // a plain error because most clients do not implement this.
  if (typeof lowLevel?.elicitInput === "function") {
    const elicitInput = (
      lowLevel.elicitInput as (
        this: unknown,
        params: unknown,
        opts?: unknown,
      ) => Promise<{ action?: string; content?: Record<string, unknown> }>
    ).bind(lowLevel);
    log.info(
      "elicitation bridge: client elicitation reachable via Server.elicitInput (bound)",
    );
    let elicitWarned = false;
    ctx.elicit = async (message, fields) => {
      try {
        const properties: Record<string, unknown> = {};
        for (const [name, f] of Object.entries(fields)) {
          properties[name] = {
            type: "string",
            ...(f.title ? { title: f.title } : {}),
            ...(f.description ? { description: f.description } : {}),
          };
        }
        const result = await elicitInput(
          { message, requestedSchema: { type: "object", properties } },
          {},
        );
        if (
          result?.action === "accept" &&
          result.content &&
          typeof result.content === "object"
        ) {
          return result.content;
        }
        return null;
      } catch (e) {
        if (!elicitWarned) {
          elicitWarned = true;
          log.warn(
            `elicitation bridge declined by client (${String(e)}) — tools fall back to plain errors`,
          );
        }
        return null;
      }
    };
  } else {
    log.info(
      "elicitation bridge unavailable: Server.elicitInput not found on the SDK's low-level server",
    );
  }

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
  //
  // Note: MCP 2026-07-28 moves sampling into the deprecated feature set, so
  // this stays an opt-in accelerator and never a dependency.
  if (typeof lowLevel?.createMessage === "function") {
    const createMessage = (
      lowLevel.createMessage as (
        this: unknown,
        req: unknown,
        opts?: unknown,
      ) => Promise<{ content?: { type: string; text?: string } }>
    ).bind(lowLevel);
    log.info(
      "sampling bridge: client sampling reachable via Server.createMessage (bound)",
    );
    let warned = false;
    ctx.sampling = async (prompt, system, maxTokens) => {
      try {
        const result = await createMessage(
          {
            messages: [
              { role: "user", content: { type: "text", text: prompt } },
            ],
            systemPrompt: system,
            maxTokens,
          },
          {},
        );
        return result?.content?.type === "text"
          ? (result.content.text ?? null)
          : null;
      } catch (e) {
        if (!warned) {
          warned = true;
          log.warn(
            `sampling bridge declined by client (${String(e)}) — plan/submit remains the default path`,
          );
        }
        return null;
      }
    };
  } else {
    log.warn(
      "sampling bridge unavailable: Server.createMessage not found on the SDK's low-level server",
    );
  }

  return server;
}

export { TOOL_COUNT };
