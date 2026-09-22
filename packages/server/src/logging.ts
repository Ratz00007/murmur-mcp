/** Stderr-only logger. stdout belongs to the MCP protocol — never log there. */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const v = (process.env.MURMUR_LOG ?? "warn").toLowerCase();
  return LEVELS[(v as Level)] ?? 30;
}

function emit(level: Level, msg: string): void {
  if (LEVELS[level] < currentLevel()) return;
  const line = `[murmur ${level}] ${msg}`;
  if (level === "error") process.stderr.write(line + "\n");
  else process.stderr.write(line + "\n");
}

export const log = {
  debug: (msg: string) => emit("debug", msg),
  info: (msg: string) => emit("info", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string) => emit("error", msg),
};
