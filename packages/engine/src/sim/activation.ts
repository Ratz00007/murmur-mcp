/**
 * Round phase 1 — Activation. Weighted deterministic sampling: activity level,
 * engagement heat from the previous round, recency backoff so one loud
 * persona cannot dominate every round.
 */
import type { Persona, Post, World } from "../types.js";
import { engagementScore } from "../util/engagement.js";
import { streamRng } from "../util/rng.js";

export function engagementOf(p: Post): number {
  return engagementScore(p.metrics);
}

export function activatePersonas(world: World, personas: Persona[], posts: Post[], targetRound: number, maxPersonas: number): string[] {
  const rng = streamRng(world.seed, `activation:${targetRound}`);
  const prevRound = posts.filter((p) => p.round === targetRound - 1);
  const heat = new Map<string, number>();
  for (const p of prevRound) heat.set(p.personaId, (heat.get(p.personaId) ?? 0) + engagementOf(p) + 1);
  const actedLast = new Set(prevRound.map((p) => p.personaId));
  const actedTwoAgo = new Set(posts.filter((p) => p.round === targetRound - 2).map((p) => p.personaId));

  const items = personas.map((p) => {
    let w = Math.max(0.05, p.activity) * (0.5 + 0.1 * (heat.get(p.id) ?? 0));
    if (actedLast.has(p.id) && actedTwoAgo.has(p.id)) w *= 0.45;
    else if (actedLast.has(p.id)) w *= 0.65;
    // engagement heat on entities this persona cares about
    return { id: p.id, w };
  });

  const k = Math.max(1, Math.min(maxPersonas, Math.ceil(personas.length * 0.4)));
  const sampled = rng.sampleWeighted(items, (i) => i.w, k);
  return sampled.map((i) => i.id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
