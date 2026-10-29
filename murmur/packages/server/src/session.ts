/**
 * ServerContext — one instance per server process. Owns the workspace,
 * the SQLite storage and the active-world pointer, and builds every tool
 * response (with resource-discipline enforcement: oversized payloads spill
 * to the world directory and are answered with receipts + pointers).
 */
import {
  openDatabase,
  Storage,
  Workspace,
  estTokens,
  nowIso,
  type World,
} from "@murmur/engine";
import type { ZodTypeAny } from "zod";
import { log } from "./logging.js";

export type SamplingFn = (
  prompt: string,
  system: string,
  maxTokens: number,
) => Promise<string | null>;

/**
 * Ask the user for a missing value through MCP elicitation, when the client
 * supports it. Returns the submitted content, or null when elicitation is
 * unavailable or declined — callers MUST fall back to a plain error, because
 * most clients do not implement elicitation and the tool must work there too.
 */
export type ElicitFn = (
  message: string,
  fields: Record<string, { title?: string; description?: string }>,
) => Promise<Record<string, unknown> | null>;

export class ServerContext {
  readonly workspace: Workspace;
  readonly storage: Storage;
  activeWorldId: string | null = null;
  sampling: SamplingFn | null = null;
  elicit: ElicitFn | null = null;

  constructor(cwd: string) {
    this.workspace = new Workspace(cwd);
    this.workspace.ensure();
    this.storage = new Storage(openDatabase(this.workspace.dbPath));
    const latest = this.storage.latestWorld();
    this.activeWorldId = latest?.id ?? null;
    log.info(
      `workspace: ${this.workspace.root} (active world: ${this.activeWorldId ?? "none"})`,
    );
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
    if (idOrSlug?.trim()) {
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
      this.workspace.appendJsonl(this.workspace.auditPath(world.slug), {
        ts: nowIso(),
        world: world.id,
        ...entry,
      });
    } catch (e) {
      log.warn(`audit write failed: ${String(e)}`);
    }
  }

  /**
   * Render a tool result. If the JSON body exceeds the context budget
   * (default 12,000 tokens), the full payload is written to the world's
   * artifacts directory and the response becomes a pointer receipt.
   *
   * `structuredContent` is emitted **only** when the caller passes the tool's
   * declared `outputSchema`. Per the MCP spec a tool that declares an
   * `outputSchema` MUST return `structuredContent`, and a tool that does not
   * declare one has no business returning it; the SDK validates the pair on
   * every call, so making the schema the switch keeps the two impossible to
   * desynchronise. The same JSON is always mirrored in a text block, for
   * clients that predate structured output.
   */
  reply(
    data: unknown,
    world?: World | null,
    output?: ZodTypeAny,
  ): {
    content: { type: "text"; text: string }[];
    structuredContent?: Record<string, unknown>;
  } {
    const maxTokens = world?.config.context.maxResponseTokens ?? 12000;
    const body = JSON.stringify(data);
    const structured = output ? asRecord(data) : null;
    if (output && !structured) {
      // A declared outputSchema with a non-object payload is a programming
      // error: the schema (and the SDK's validation of it) assume an object.
      throw new Error(
        `reply() given a non-object payload for a tool that declares an outputSchema: ${typeof data}`,
      );
    }
    if (estTokens(body) <= maxTokens) {
      return {
        content: [{ type: "text", text: body }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    }
    if (!world) {
      const err = {
        ok: false,
        error: "response exceeds context budget",
        hint: "narrow the request (fewer items, tighter query)",
        next: "re-issue with a narrower query (fewer items, lower depth, smaller budget)",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(err) }],
        ...(output ? { structuredContent: err } : {}),
      };
    }
    const name = `oversize-${Date.now().toString(36)}.json`;
    const file = this.workspace.artifactPath(world.slug, name);
    this.workspace.writeAtomic(file, JSON.stringify(data, null, 2));
    const ok = (data as { ok?: boolean })?.ok !== false;
    const receipt: Record<string, unknown> = {
      ok,
      spilled: true,
      reason: "payload exceeded the response token budget",
      artifact: this.workspace.rel(file),
      fullTokens: estTokens(JSON.stringify(data, null, 2)),
      next: "read the artifact file for the full payload, then continue",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(receipt) }],
      ...(output ? { structuredContent: receipt } : {}),
    };
  }

  fail(error: unknown): {
    content: { type: "text"; text: string }[];
    isError: boolean;
    structuredContent: Record<string, unknown>;
  } {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`tool error: ${message}`);
    const payload = { ok: false, error: message };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: true,
      structuredContent: payload,
    };
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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
