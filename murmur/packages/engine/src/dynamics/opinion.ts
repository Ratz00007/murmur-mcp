/**
 * Phase-2 science — Deffuant opinion dynamics (bounded confidence).
 *
 * Pairwise influence over the follow graph, applied alongside (never instead
 * of) the self-expression stance update in aggregate.ts computeMovers:
 *
 *   - ε (epsilon, config default 0.4): bounded-confidence radius. Two personas
 *     only influence each other when their stances differ by at most ε.
 *   - μ (mu, config default 0.2): assimilation rate — inside confidence both
 *     stances move toward each other's value by μ per interaction.
 *   - Abstention rule (beyond confidence): when |a − b| > ε the pair cannot
 *     assimilate; with probability abstentionChance (config default 0.1) both
 *     sides slightly disengage — each stance relaxes 5% toward neutral
 *     (|x| × 0.95). Otherwise they ignore each other entirely.
 *
 * Determinism: the only randomness is the abstention draw, which callers must
 * source from streamRng(world.seed, `dynamics:${round}:${i}`) via params.rng.
 * Without an rng the abstention rule is skipped (pure no-op beyond ε).
 * No unseeded randomness may appear in this file — the package test scans.
 */
import type { World } from "../types.js";
import { streamRng, type Rng } from "../util/rng.js";
import { round2Safe } from "../util/text.js";

export interface DeffuantParams {
  /** Bounded-confidence radius ε (default 0.4). */
  epsilon?: number;
  /** Assimilation rate μ for pairs within confidence (default 0.2). */
  mu?: number;
  /** P(slight disengagement) per interaction when |a − b| > ε (default 0.1). */
  abstentionChance?: number;
  /** Seeded RNG for the abstention draw; omit to disable abstention (pure). */
  rng?: Rng;
}

export type DeffuantOutcome = "converge" | "disengage" | "no-interaction";

export interface DeffuantResult {
  a: number;
  b: number;
  outcome: DeffuantOutcome;
}

function clampStance(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/**
 * One Deffuant pairwise update on a single entity stance, clamped to [-1, 1]
 * and rounded to 2 decimals (matching the stance-migration update in
 * aggregate.ts so replays stay byte-stable).
 */
export function deffuantUpdate(stanceA: number, stanceB: number, params: DeffuantParams): DeffuantResult {
  const epsilon = params.epsilon ?? 0.4;
  const mu = params.mu ?? 0.2;
  const chance = params.abstentionChance ?? 0.1;
  const a = clampStance(stanceA);
  const b = clampStance(stanceB);
  const gap = Math.abs(a - b);
  if (gap <= epsilon) {
    // Within bounded confidence: both pull toward each other simultaneously.
    return { a: round2Safe(a + mu * (b - a)), b: round2Safe(b + mu * (a - b)), outcome: "converge" };
  }
  // Beyond confidence: abstention rule — documented slight disengagement,
  // each stance relaxes 5% toward neutral, drawn from the seeded stream.
  if (params.rng && params.rng.bool(chance)) {
    return { a: round2Safe(a * 0.95), b: round2Safe(b * 0.95), outcome: "disengage" };
  }
  return { a, b, outcome: "no-interaction" };
}

/** Minimal population shape the dynamics need — Persona satisfies it. */
export interface OpinionAgent {
  id: string;
  stances: Record<string, number>;
  follows: string[];
}

export interface OpinionDynamicsParams extends DeffuantParams {
  /** Population carrying stances + follow-graph edges (Persona is assignable). */
  personas: OpinionAgent[];
  /** Cap on sampled pairs; default = half the edge list (min 1 when edges exist). */
  pairsPerRound?: number;
}

export interface OpinionStanceChange {
  personaId: string;
  entityId: string;
  from: number;
  to: number;
}

export interface OpinionDynamicsResult {
  edges: number;
  pairsSampled: number;
  interactions: { converge: number; disengage: number; noInteraction: number };
  /** Every stance that actually moved (any delta); callers decide what to record. */
  changed: OpinionStanceChange[];
}

/**
 * One round of pairwise influence: sample persona pairs from follow-graph
 * edges, then run the Deffuant rule over every entity stance both sides hold.
 * Mutates `params.personas` stances in place and reports the changes.
 *
 * Randomness (all seeded, deterministic for a given world seed + round):
 *   streamRng(world.seed, `dynamics:${round}:sample`)  — edge shuffle
 *   streamRng(world.seed, `dynamics:${round}:${i}`)    — pair i's abstention draws
 */
export function applyOpinionDynamics(world: World, round: number, params: OpinionDynamicsParams): OpinionDynamicsResult {
  const epsilon = params.epsilon ?? 0.4;
  const mu = params.mu ?? 0.2;
  const chance = params.abstentionChance ?? 0.1;
  const result: OpinionDynamicsResult = { edges: 0, pairsSampled: 0, interactions: { converge: 0, disengage: 0, noInteraction: 0 }, changed: [] };
  if (params.personas.length < 2) return result;

  // Deterministic population order, then build the directed follow-graph edge list.
  const ordered = [...params.personas].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const byId = new Map(ordered.map((p) => [p.id, p]));
  const seenEdge = new Set<string>();
  const edges: { srcId: string; dstId: string }[] = [];
  for (const src of ordered) {
    for (const dstId of src.follows) {
      if (dstId === src.id || !byId.has(dstId)) continue;
      const key = `${src.id}>${dstId}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ srcId: src.id, dstId });
    }
  }
  result.edges = edges.length;
  if (edges.length === 0) return result;

  // Sample pairs for this round: seeded shuffle, half the edges by default.
  const sampleRng = streamRng(world.seed, `dynamics:${round}:sample`);
  const shuffled = sampleRng.shuffle(edges);
  const want = params.pairsPerRound ?? Math.max(1, Math.floor(edges.length / 2));
  const pairs = shuffled.slice(0, Math.min(want, shuffled.length));
  result.pairsSampled = pairs.length;

  for (let i = 0; i < pairs.length; i++) {
    const src = byId.get(pairs[i].srcId)!;
    const dst = byId.get(pairs[i].dstId)!;
    const pairRng = streamRng(world.seed, `dynamics:${round}:${i}`);
    // Entities both personas hold an opinion on, sorted for stable draw order.
    const shared = Object.keys(src.stances)
      .filter((e) => e in dst.stances)
      .sort();
    for (const entityId of shared) {
      const before = { a: src.stances[entityId], b: dst.stances[entityId] };
      const out = deffuantUpdate(before.a, before.b, { epsilon, mu, abstentionChance: chance, rng: pairRng });
      const bucket = out.outcome === "converge" ? "converge" : out.outcome === "disengage" ? "disengage" : "noInteraction";
      result.interactions[bucket]++;
      if (out.a !== before.a) {
        src.stances[entityId] = out.a;
        result.changed.push({ personaId: src.id, entityId, from: before.a, to: out.a });
      }
      if (out.b !== before.b) {
        dst.stances[entityId] = out.b;
        result.changed.push({ personaId: dst.id, entityId, from: before.b, to: out.b });
      }
    }
  }
  return result;
}
