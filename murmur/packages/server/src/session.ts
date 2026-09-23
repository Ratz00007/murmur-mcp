/**
 * ServerContext — one instance per server process. Owns the workspace,
 * the SQLite storage and the active-world pointer, and builds every tool
 * response (with resource-discipline enforcement: oversized payloads spill
 * to the world directory and are answered with receipts + pointers).
 */
import { openDatabase, Storage, Workspace, estTokens, nowIso, type World } from "@murmur/engine";
import { log } from "./logging.js";

export type SamplingFn = (prompt: string, system: string, maxTokens: number) => Promise<string | null>;

export class ServerContext {
  readonly workspace: Workspace;
  readonly storage: Storage;
  activeWorldId: string | null = null;
  sampling: SamplingFn | null = null;

  constructor(cwd: string) {
    this.workspace = new Workspace(cwd);
    this.workspace.ensure();
    this.storage = new Storage(openDatabase(this.workspace.dbPath));
    const latest = this.storage.latestWorld();
    this.activeWorldId = latest?.id ?? null;
    log.info(`workspace: ${this.workspace.root} (active world: ${this.activeWorldId ?? "none"})`);
  }

  close(): void {
    try {
      this.storage.close();
    } catch {
      /* ignore */
    }
  }

  listWorlds(): World[] {
    return this.storage.listWorlds();
  }

  /** Resolve the target world: explicit id/slug → active world → latest world. */
  resolveWorld(idOrSlug?: string): World {
    if (idOrSlug && idOrSlug.trim()) {
      const w = this.storage.getWorld(idOrSlug.trim());
      if (!w) throw new Error(`world not found: ${idOrSlug} (see world_list)`);
      this.activeWorldId = w.id;
      return w;
    }
    if (this.activeWorldId) {
      const w = this.storage.getWorld(this.activeWorldId);
      if (w) return w;
    }
    const latest = this.storage.latestWorld();
    if (latest) {
      this.activeWorldId = latest.id;
      return latest;
    }
    throw new Error("no world exists yet — call world_init first");
  }

  audit(world: World, entry: Record<string, unknown>): void {
    try {
      this.workspace.appendJsonl(this.workspace.auditPath(world.slug), { ts: nowIso(), world: world.id, ...entry });
    } catch (e) {
      log.warn(`audit write failed: ${String(e)}`);
    }
  }

  /**
   * Render a tool result. If the JSON body exceeds the context budget
   * (default 12,000 tokens), the full payload is written to the world's
   * artifacts directory and the response becomes a pointer receipt.
   */
  reply(data: unknown, world?: World | null): { content: { type: "text"; text: string }[] } {
    const maxTokens = (world?.config.context.maxResponseTokens ?? 12000);
    const body = JSON.stringify(data);
    if (estTokens(body) <= maxTokens) {
      return { content: [{ type: "text", text: body }] };
    }
    if (!world) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: false, error: "response exceeds context budget", hint: "narrow the request (fewer items, tighter query)" }) },
        ],
      };
    }
    const name = `oversize-${Date.now().toString(36)}.json`;
    const file = this.workspace.artifactPath(world.slug, name);
    this.workspace.writeAtomic(file, JSON.stringify(data, null, 2));
    const ok = (data as { ok?: boolean })?.ok !== false;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok,
            truncated: true,
            reason: "payload exceeded the response token budget",
            artifact: this.workspace.rel(file),
            fullTokens: estTokens(JSON.stringify(data, null, 2)),
            next: "read the artifact file for the full payload, then continue",
          }),
        },
      ],
    };
  }

  fail(error: unknown): { content: { type: "text"; text: string }[]; isError: boolean } {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`tool error: ${message}`);
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true };
  }
}

/** Coerce a tool argument that may arrive as a JSON string or an object. */
export function coerceJson(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }
  return v;
}
