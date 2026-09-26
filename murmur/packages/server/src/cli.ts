/** CLI entry: serve (default) | doctor | init | templates | version | help. */
import * as fs from "node:fs";
import * as path from "node:path";
import { CLIENTS, findClient, renderInstall, type ServerCommand } from "@murmur/adapters";
import { findScenario, SCENARIOS } from "@murmur/templates";
import { printDoctor, runDoctor } from "./doctor.js";
import { SERVER_VERSION } from "./server.js";

export type CliAction = "serve" | "doctor" | "init" | "templates" | "version" | "help";

export function parseArgs(argv: string[]): { action: CliAction; flags: Record<string, string | boolean> } {
  const args = [...argv];
  const flagNames = new Set(["client", "template", "write", "server"]);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a === "--write" || a === "-w") flags.write = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (flagNames.has(key) && args.length && !args[0].startsWith("--")) flags[key] = args.shift()!;
      else flags[key] = true;
    } else if (a === "-v" || a === "--version") flags.version = true;
    else if (a === "-h" || a === "--help") flags.help = true;
    else positional.push(a);
  }
  let action: CliAction = "serve";
  const first = positional[0];
  if (flags.version) action = "version";
  else if (flags.help) action = "help";
  else if (first === "serve") action = "serve";
  else if (first === "doctor") action = "doctor";
  else if (first === "init") action = "init";
  else if (first === "templates") action = "templates";
  else if (first === "version") action = "version";
  else if (first === "help") action = "help";
  else if (first) action = "help";
  return { action, flags };
}

/** When running from a repo checkout (unpublished), prefer a direct node command. */
export function resolveServerCommand(cwd: string): ServerCommand {
  const repoServer = path.join(cwd, "packages", "server", "package.json");
  const fromParent = path.join(cwd, "..", "..", "packages", "server", "package.json");
  for (const p of [repoServer, fromParent]) {
    try {
      if (fs.existsSync(p)) {
        const dist = path.join(path.dirname(p), "dist", "index.js");
        if (fs.existsSync(dist)) return { command: process.execPath, args: [dist] };
      }
    } catch {
      /* ignore */
    }
  }
  return { command: "npx", args: ["-y", "murmur-mcp"] };
}

export function printHelp(): void {
  const out = process.stdout;
  out.write(`
murmur-mcp ${SERVER_VERSION} — social-simulation MCP server for coding agents.
Zero API keys: all generation runs on the coding subscription you already pay for.

Usage:
  murmur-mcp                      Start the MCP server on stdio (default)
  murmur-mcp serve                Same as above
  murmur-mcp doctor               Check Node, SQLite, workspace; print client install snippets
  murmur-mcp init [--client ID]   Show (or --write) the MCP config for one client
  murmur-mcp init --template ID   Copy a scenario template (launch|policy|crisis|finance|fiction) into .
  murmur-mcp templates            List scenario templates
  murmur-mcp version              Print version

In your coding agent, use prompts: /murmur-predict, /murmur-simulate, /murmur-interview, /murmur-resume
See the README for the full 10-client support matrix and the .murmur/ directory layout.

Environment:
  MURMUR_WORKSPACE   Project root that CONTAINS the .murmur/ directory
                     (default: nearest ancestor with .murmur/ or .git/, else cwd).
                     Do NOT point this at the .murmur directory itself — the
                     server appends .murmur, which would nest .murmur/.murmur/.
  MURMUR_LOG         stderr log level: debug|info|warn|error (default warn)
`);
}

export async function runCli(argv: string[]): Promise<number> {
  const { action, flags } = parseArgs(argv);
  const cwd = process.cwd();

  switch (action) {
    case "version": {
      process.stdout.write(`murmur-mcp ${SERVER_VERSION}\n`);
      return 0;
    }
    case "help": {
      printHelp();
      return 0;
    }
    case "doctor": {
      const report = await runDoctor(cwd);
      printDoctor(report);
      return report.ok ? 0 : 1;
    }
    case "templates": {
      process.stdout.write("\nScenario templates (murmur-mcp init --template <id>):\n\n");
      for (const s of SCENARIOS) {
        process.stdout.write(`  ${s.id.padEnd(10)} ${s.title}\n             ${s.description}\n             suggested: ${s.suggested.rounds} rounds · ${s.suggested.personas} personas · focus "${s.suggested.focus}"\n\n`);
      }
      return 0;
    }
    case "init": {
      const server = resolveServerCommand(cwd);
      let wrote: string[] = [];
      if (typeof flags.template === "string") {
        const scenario = findScenario(flags.template);
        if (!scenario) {
          process.stderr.write(`unknown template: ${flags.template} (options: ${SCENARIOS.map((s) => s.id).join(", ")})\n`);
          return 1;
        }
        const file = path.join(cwd, `scenario-${scenario.id}.md`);
        fs.writeFileSync(file, scenario.markdown, "utf8");
        wrote.push(file);
        process.stdout.write(`✓ wrote ${path.basename(file)} — fill the {{PLACEHOLDERS}}, attach it as a seed, then run /murmur-predict\n`);
        process.stdout.write(`  suggested: ${scenario.suggested.rounds} rounds · ${scenario.suggested.personas} personas\n`);
      }
      const clientId = typeof flags.client === "string" ? flags.client : undefined;
      if (clientId) {
        const client = findClient(clientId);
        if (!client) {
          process.stderr.write(`unknown client: ${clientId} (options: ${CLIENTS.map((c) => c.id).join(", ")})\n`);
          return 1;
        }
        process.stdout.write("\n" + renderInstall(client, server) + "\n");
        if (flags.write) {
          const projectConfigs: Record<string, string> = {
            cursor: path.join(cwd, ".cursor", "mcp.json"),
            vscode: path.join(cwd, ".vscode", "mcp.json"),
            opencode: path.join(cwd, "opencode.json"),
            windsurf: path.join(cwd, ".windsurf", "mcp_config.json"),
          };
          const target = projectConfigs[client.id];
          if (target && !fs.existsSync(target)) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, client.configSnippet(server) + "\n", "utf8");
            process.stdout.write(`✓ wrote ${path.relative(cwd, target)}\n`);
            wrote.push(target);
          } else if (target) {
            process.stdout.write(`! ${path.relative(cwd, target)} already exists — merge the snippet above manually (do not let a tool overwrite your config)\n`);
          } else {
            process.stdout.write(`! --write not supported for ${client.name}; copy the snippet above into ${client.configPath}\n`);
          }
        }
      } else if (!flags.template) {
        process.stdout.write("\nClients (murmur-mcp init --client <id> for the exact snippet):\n\n");
        for (const c of CLIENTS) {
          process.stdout.write(`  ${c.id.padEnd(14)} ${c.name} — ${c.install ?? `config: ${c.configPath}`}\n`);
        }
        process.stdout.write("\nTemplates: murmur-mcp templates\nDiagnostics: murmur-mcp doctor\n");
      }
      void wrote;
      wrote = [];
      return 0;
    }
    case "serve":
      return -1; // signal caller to start the server
    default:
      printHelp();
      return 0;
  }
}
