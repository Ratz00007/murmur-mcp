/**
 * Stderr-first logger with an optional MCP sink. stdout belongs to the MCP
 * protocol — never log there. The MCP sink mirrors warn-and-above to the
 * client via notifications/message when a client is connected; everything
 * still goes to stderr regardless, so diagnostics never depend on the client
 * doing anything with them.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** MCP notification levels the spec defines for logging/message. */
const MCP_LEVELS: Record<string, Level> = {
  debug: "debug",
  info: "info",
  notice: "info",
  warning: "warn",
  error: "error",
  critical: "error",
  alert: "error",
  emergency: "error",
};

function currentLevel(): number {
  const v = (process.env.MURMUR_LOG ?? "warn").toLowerCase();
  return LEVELS[(v as Level)] ?? 30;
}

type McpSink = (level: "debug" | "info" | "notice" | "warning" | "error", message: string) => Promise<void> | void;

let sink: McpSink | null = null;

/** Installed once the server is connected; cleared never (process-lifetime). */
export function setMcpLogSink(fn: McpSink | null): void {
  sink = fn;
}

function emit(level: Level, msg: string): void {
  if (LEVELS[level] < currentLevel()) return;
  process.stderr.write(`[murmur ${level}] ${msg}\n`);
  // Mirror warn-and-above to the client. Best-effort by design: a logging
  // failure must never break the tool call it annotates, and a client that
  // never asked for logging simply receives notifications it ignores.
  if (sink && LEVELS[level] >= 30) {
    const mcpLevel = level === "warn" ? "warning" : level;
    try {
      const r = sink(mcpLevel, msg);
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch(() => {});
      }
    } catch {
      // sink failures are silent — stderr already carries the message
    }
  }
}

export function mcpLevelToLocal(level: string): Level {
  return MCP_LEVELS[level] ?? "info";
}

export const log = {
  debug: (msg: string) => emit("debug", msg),
  info: (msg: string) => emit("info", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string) => emit("error", msg),
};
