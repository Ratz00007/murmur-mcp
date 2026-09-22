/**
 * The local memory subsystem (replaces any cloud memory service):
 *   working  — engine-composed digest each persona sees each round
 *   episodic — per-persona log of salient events, compacted deterministically
 *   collective — world-level facts, tensions and injected events
 */
import type { MemoryRecord, MurmurConfig, Persona, World } from "./types.js";
import type { Storage } from "./store/storage.js";
import { estTokens, truncate } from "./util/text.js";

export interface WorkingMemory {
  summary: string;
  recent: string[];
  tokens: number;
}

export function workingMemory(storage: Storage, world: World, persona: Persona, targetRound: number, config: MurmurConfig): WorkingMemory {
  const episodic = storage.listMemories(world.id, { personaId: persona.id, tier: "episodic", limit: 60 });
  const summaries = episodic.filter((m) => m.kind === "summary");
  const events = episodic.filter((m) => m.kind === "event").slice(0, 30);
  const summary =
    summaries.length > 0
      ? truncate(summaries.sort((a, b) => b.round - a.round || b.id.localeCompare(a.id))[0].content, 400)
      : "(no prior episodes)";
  const recent = events
    .slice(0, 3)
    .map((m) => truncate(m.content, 160));
  let wm: WorkingMemory = { summary, recent, tokens: estTokens(JSON.stringify({ summary, recent })) };
  while (wm.tokens > config.batch.memoryTokens && wm.recent.length > 0) {
    wm = { ...wm, recent: wm.recent.slice(0, wm.recent.length - 1) };
    wm.tokens = estTokens(JSON.stringify({ summary: wm.summary, recent: wm.recent }));
  }
  return wm;
}

export function appendEpisodic(
  storage: Storage,
  world: World,
  personaId: string,
  round: number,
  content: string,
  salience: number
): void {
  storage.appendMemory(world.id, personaId, "episodic", "event", content, salience, round);
}

/**
 * Deterministic compaction: when a persona's episodic event log exceeds the
 * cap, the oldest records are folded into a summary record. Full logs are
 * never lost from the audit trail — posts and events tables keep everything;
 * interviews re-expand from those.
 */
export function compactIfNeeded(storage: Storage, world: World, persona: Persona, config: MurmurConfig): { compacted: number } {
  const count = storage.countMemories(world.id, persona.id, "episodic");
  // summary records count toward the budget too — only event records compact
  const events = storage
    .listMemories(world.id, { personaId: persona.id, tier: "episodic", limit: 100000 })
    .filter((m) => m.kind === "event");
  if (events.length <= config.memory.episodicMaxRecords) return { compacted: 0 };
  // oldest first
  const ordered = [...events].sort((a, b) => a.round - b.round || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const toCompact = ordered.slice(0, events.length - config.memory.episodicKeep);
  if (toCompact.length === 0) return { compacted: 0 };
  const salient = [...toCompact].sort((a, b) => b.salience - a.salience || a.round - b.round).slice(0, 5);
  const lines = salient.map((m) => `r${m.round}: ${truncate(m.content, 120)}`);
  const content =
    `Compacted ${toCompact.length} episodes (rounds ${toCompact[0].round}-${toCompact[toCompact.length - 1].round}). ` +
    `Most salient: ${lines.join(" | ")}`;
  storage.appendMemory(world.id, persona.id, "episodic", "summary", content, 0.9, toCompact[toCompact.length - 1].round);
  storage.deleteMemories(toCompact.map((m) => m.id));
  return { compacted: toCompact.length };
}

/** World-level collective layer: tensions, trending entities, active injections. */
export interface CollectiveView {
  tensions: string[];
  events: string[];
  trending: string[];
  tokens: number;
}

export function collectiveView(
  storage: Storage,
  world: World,
  entityNames: Map<string, string>,
  targetRound: number,
  config: MurmurConfig,
  trending: string[]
): CollectiveView {
  const relations = storage.listRelations(world.id).filter((r) => r.tension >= 0.5).slice(0, 2);
  const tensions = relations.map(
    (r) => `${entityNames.get(r.srcId) ?? r.srcId} ↔ ${entityNames.get(r.dstId) ?? r.dstId}: ${r.type} (tension ${r.tension.toFixed(2)})`
  );
  const injections = storage
    .listEvents(world.id, { type: "injection", sinceRound: targetRound - 2 })
    .map((e) => `<event>r${e.round}: ${String(e.payload.text ?? JSON.stringify(e.payload))}</event>`);
  const view: CollectiveView = { tensions, events: injections.slice(0, 3), trending: trending.slice(0, 4), tokens: 0 };
  view.tokens = estTokens(JSON.stringify(view));
  while (view.tokens > config.batch.collectiveTokens && view.trending.length > 1) {
    view.trending.pop();
    view.tokens = estTokens(JSON.stringify(view));
  }
  return view;
}

export function memoryTimeline(storage: Storage, world: World, personaId: string, limit = 40): MemoryRecord[] {
  return storage.listMemories(world.id, { personaId, tier: "episodic", limit });
}
