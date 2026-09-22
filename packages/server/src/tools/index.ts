/** Tool registry — all 29 tools from the PRD catalog. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../session.js";
import { registerWorldTools } from "./world.js";
import { registerSeedTools } from "./seeds.js";
import { registerOntologyTools } from "./ontology.js";
import { registerGraphTools } from "./graph.js";
import { registerPersonaTools } from "./personas.js";
import { registerSimTools } from "./sim.js";
import { registerReportTools } from "./report.js";
import { registerInteractTools } from "./interact.js";

export const TOOL_COUNT = 29;

export function registerTools(server: McpServer, ctx: ServerContext): void {
  registerWorldTools(server, ctx);
  registerSeedTools(server, ctx);
  registerOntologyTools(server, ctx);
  registerGraphTools(server, ctx);
  registerPersonaTools(server, ctx);
  registerSimTools(server, ctx);
  registerReportTools(server, ctx);
  registerInteractTools(server, ctx);
}
