/**
 * @murmur/adapters — per-client install snippets, config templates and
 * detection. Client neutrality lives HERE, never in the server: the server
 * contains zero client-specific branches. A new MCP client is supported the
 * day someone adds a 20-line adapter here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ServerCommand {
  command: string;
  args: string[];
}

export const NPM_SERVER: ServerCommand = { command: "npx", args: ["-y", "murmur-mcp"] };

/** Command as a single shell line, e.g. `npx -y murmur-mcp`. */
export const commandLine = (server: ServerCommand) => `${server.command} ${server.args.join(" ")}`;

export interface ClientAdapter {
  id: string;
  name: string;
  kind: "cli" | "ide";
  /** One-liner install command, or null for config-file clients. */
  install: string | null;
  /** Where the MCP config lives (display string). */
  configPath: string;
  /** Rendered config snippet for this client. */
  configSnippet: (server: ServerCommand) => string;
  /** Language of the rendered snippet, used for the markdown fence. */
  configFormat: "json" | "yaml";
  /** True when the client/file/key below still needs first-party verification. */
  unverified?: boolean;
  notes: string;
  /** Heuristic detection of an existing client setup. */
  detect: (ctx: DetectCtx) => boolean;
}

export interface DetectCtx {
  cwd: string;
  home: string;
  exists(p: string): boolean;
}

const jsonEntry = (server: ServerCommand, key = "murmur") =>
  JSON.stringify({ mcpServers: { [key]: { command: server.command, args: server.args } } }, null, 2);

/** VS Code Copilot: top-level `servers`, each entry requires `type: "stdio"`. */
const vscodeServers = (server: ServerCommand, key = "murmur") =>
  `// .vscode/mcp.json — merge into your existing file\n${JSON.stringify(
    { servers: { [key]: { type: "stdio", command: server.command, args: server.args } } },
    null,
    2,
  )}`;

/** OpenCode: `mcp` map, `type: "local"`, command is an array. */
const opencodeMcp = (server: ServerCommand, key = "murmur") =>
  `// opencode.json — merge the mcp block into your existing file\n${JSON.stringify(
    { mcp: { [key]: { type: "local", command: [server.command, ...server.args], enabled: true } } },
    null,
    2,
  )}`;

/** Continue: YAML list of {name, command, args}. */
const continueYaml = (server: ServerCommand, key = "murmur") =>
  [
    "# Continue: ~/.continue/config.yaml — merge this mcpServers list into your existing file",
    "name: Local Assistant",
    "version: 1.0.0",
    "schema: v1",
    "mcpServers:",
    `  - name: ${key}`,
    `    command: ${server.command}`,
    "    args:",
    ...server.args.map((a) => `      - ${a}`),
  ].join("\n");

const UNVERIFIED = "UNVERIFIED: check this client's own docs for the exact file and key before pasting.";

export const CLIENTS: ClientAdapter[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "cli",
    install: "claude mcp add murmur -- npx -y murmur-mcp",
    configPath: "managed by the claude CLI (per-project: .claude/settings.json)",
    configSnippet: (s) => jsonEntry(s),
    notes: "Reference client. Prompts surface as /murmur-predict, /murmur-simulate, /murmur-interview, /murmur-resume slash commands.",
    detect: ({ home, cwd, exists }) => exists(path.join(home, ".claude.json")) || exists(path.join(cwd, ".claude")),
  },
  {
    id: "codex",
    name: "Codex CLI",
    kind: "cli",
    install: "codex mcp add murmur -- npx -y murmur-mcp",
    configPath: "~/.codex/config.toml",
    configSnippet: (s) =>
      `# ~/.codex/config.toml\n[mcp_servers.murmur]\ncommand = "${s.command}"\nargs = [${s.args.map((a) => `"${a}"`).join(", ")}]`,
    notes: "Rides your ChatGPT/ Codex subscription plan.",
    detect: ({ home, exists }) => exists(path.join(home, ".codex")),
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    kind: "cli",
    install: "gemini mcp add murmur -- npx -y murmur-mcp",
    configPath: "~/.gemini/settings.json",
    configSnippet: (s) => jsonEntry(s),
    notes: "Uses your Gemini plan quota.",
    detect: ({ home, exists }) => exists(path.join(home, ".gemini")),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "ide",
    install: null,
    configPath: "agent settings JSON (mcpServers block) — see Antigravity MCP docs for the exact file for your version",
    configSnippet: (s) => jsonEntry(s),
    notes: "Google agentic IDE; paste the mcpServers entry into your agent configuration.",
    detect: ({ home, cwd, exists }) => exists(path.join(home, ".antigravity")) || exists(path.join(cwd, ".antigravity")),
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "cli",
    install: null,
    configPath: "opencode.json (project root)",
    configSnippet: (s) =>
      `// opencode.json — merge the mcp block into your existing file\n${jsonEntry(s)}`,
    notes: "Open client; works with any backing subscription.",
    detect: ({ cwd, exists }) => exists(path.join(cwd, "opencode.json")),
  },
  {
    id: "hermes",
    name: "Hermes",
    kind: "cli",
    install: null,
    configPath: "hermes config JSON (mcpServers block)",
    configSnippet: (s) => jsonEntry(s),
    notes: "Terminal-first agent — founding-requirement client. Paste into your Hermes MCP config.",
    detect: ({ home, exists }) => exists(path.join(home, ".hermes")) || exists(path.join(home, "hermes.json")),
  },
  {
    id: "cursor",
    name: "Cursor",
    kind: "ide",
    install: "cursor mcp add murmur -- npx -y murmur-mcp",
    configPath: ".cursor/mcp.json (project) or global MCP settings",
    configSnippet: (s) => jsonEntry(s),
    notes: "Also works via the project .cursor/mcp.json file.",
    detect: ({ cwd, exists }) => exists(path.join(cwd, ".cursor")),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    kind: "ide",
    install: null,
    configPath: "~/.codeium/windsurf/mcp_config.json",
    configSnippet: (s) => jsonEntry(s),
    notes: "Cascade MCP settings entry.",
    detect: ({ home, cwd, exists }) => exists(path.join(home, ".codeium")) || exists(path.join(cwd, ".windsurf")),
  },
  {
    id: "cline-continue",
    name: "Cline / Continue",
    kind: "ide",
    install: null,
    configPath:
      "Cline: VS Code globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json · Continue: ~/.continue/config.yaml (mcpServers)",
    configSnippet: (s) => jsonEntry(s),
    notes: "VS Code family via config templates.",
    detect: ({ cwd, home, exists }) => exists(path.join(cwd, ".vscode")) || exists(path.join(home, ".continue")),
  },
  {
    id: "vscode",
    name: "VS Code Copilot",
    kind: "ide",
    install: null,
    configPath: ".vscode/mcp.json (workspace)",
    configSnippet: (s) => jsonEntry(s),
    notes: "GitHub Copilot agent mode, workspace-scoped.",
    detect: ({ cwd, exists }) => exists(path.join(cwd, ".vscode")),
  },
];

export function findClient(id: string): ClientAdapter | undefined {
  const key = id.toLowerCase();
  return CLIENTS.find((c) => c.id === key || c.name.toLowerCase() === key);
}

export interface Detection {
  client: ClientAdapter;
  configured: boolean; // murmur already referenced in a plausible config file
}

export function detectClients(cwd: string, home = os.homedir()): Detection[] {
  const exists = (p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };
  const ctx: DetectCtx = { cwd, home, exists };
  const out: Detection[] = [];
  for (const client of CLIENTS) {
    if (!client.detect(ctx)) continue;
    let configured = false;
    const candidates = [
      path.join(cwd, ".cursor", "mcp.json"),
      path.join(cwd, ".vscode", "mcp.json"),
      path.join(cwd, "opencode.json"),
      path.join(home, ".claude.json"),
      path.join(home, ".codex", "config.toml"),
      path.join(home, ".gemini", "settings.json"),
    ];
    for (const f of candidates) {
      try {
        if (exists(f) && fs.readFileSync(f, "utf8").includes("murmur")) configured = true;
      } catch {
        /* ignore */
      }
    }
    out.push({ client, configured });
  }
  return out;
}

/** Render the install instructions block for one client. */
export function renderInstall(client: ClientAdapter, server: ServerCommand = NPM_SERVER): string {
  const lines = [`# ${client.name} (${client.kind})`];
  if (client.install) {
    lines.push(`One-liner:  ${client.install.replace("npx -y murmur-mcp", `${server.command} ${server.args.join(" ")}`)}`);
  }
  lines.push(`Config file: ${client.configPath}`);
  lines.push("");
  lines.push("```json");
  lines.push(client.configSnippet(server));
  lines.push("```");
  if (client.notes) lines.push(`Note: ${client.notes}`);
  return lines.join("\n");
}
