/** MCP prompts: the four one-command playbooks from @murmur/prompts. */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROMPTS } from "@murmur/prompts";

export function registerPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const a of p.args) {
      let t = z.string().max(2000).describe(a.description);
      if (!a.required) t = t.optional() as z.ZodString;
      shape[a.name] = t;
    }
    server.prompt(
      p.name,
      p.description,
      shape,
      async (args) => {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(args)) clean[k] = String(v ?? "");
        return {
          messages: [
            {
              role: "user",
              content: { type: "text", text: p.build(clean) },
            },
          ],
        };
      }
    );
  }
}
