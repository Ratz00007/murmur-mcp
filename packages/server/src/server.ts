/** Server assembly: McpServer + tools + resources + prompts + sampling bridge. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "./session.js";
import { registerTools, TOOL_COUNT } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export const SERVER_NAME = "murmur-mcp";
export const SERVER_VERSION = "1.0.0-rc.1";

export function buildServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);

  // Optional accelerator: MCP sampling, when the client supports it.
  // Plan/submit remains the universal default path on every client.
  ctx.sampling = async (prompt, system, maxTokens) => {
    try {
      const anyServer = server as unknown as {
        sampling?: { createMessage: (req: unknown, opts?: unknown) => Promise<{ content?: { type: string; text?: string } }> };
        server?: { sampling?: { createMessage: (req: unknown, opts?: unknown) => Promise<{ content?: { type: string; text?: string } }> } };
      };
      const s = anyServer.sampling ?? anyServer.server?.sampling;
      if (!s?.createMessage) return null;
      const result = await s.createMessage(
        {
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          systemPrompt: system,
          maxTokens,
        },
        {}
      );
      return result?.content?.type === "text" ? (result.content.text ?? null) : null;
    } catch {
      return null;
    }
  };

  return server;
}

export { TOOL_COUNT };
