/**
 * Degree-heterogeneous follow topology: truncated-zipf outgoing counts within
 * the historical [3, 7] bounds (~20% hubs) plus preferential attachment that
 * concentrates incoming follows. Deterministic under streamRng.
 */
import { describe, expect, it } from "vitest";
import { buildFollowGraph } from "@murmur/engine";
import type { Persona, World } from "@murmur/engine";

const world = (seed: string): World => ({ seed }) as World;

function personas(n: number): Persona[] {
  return Array.from({ length: n }, (_, i): Persona => {
    const v1 = i % 3 === 0 ? 0.8 : i % 3 === 1 ? 0.1 : -0.6;
    const v2 = i % 4 === 0 ? -0.5 : 0.4;
    return {
      id: `p_${i + 1}`,
      worldId: "w_test",
      name: `Person ${i + 1}`,
      handle: `@p${i + 1}`,
      archetype: "casual scroller",
      bio: "b",
      traits: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: ((i * 7) % 10) / 10,
        agreeableness: 0.5,
        emotionalStability: 0.5,
      },
      stances: { e_1: v1, e_2: v2 },
      platform: "both",
      activity: 0.3 + (i % 5) * 0.1,
      communityIds: [],
      follows: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    } as Persona;
  });
}

function summarize(list: { personaId: string; follows: string[] }[], n: number) {
  const inDeg = new Map<string, number>(Array.from({ length: n }, (_, i) => [`p_${i + 1}`, 0]));
  for (const e of list) for (const f of e.follows) inDeg.set(f, (inDeg.get(f) ?? 0) + 1);
  const incoming = [...inDeg.values()];
  const total = incoming.reduce((a, b) => a + b, 0);
  const sorted = [...incoming].sort((a, b) => b - a);
  const topN = Math.ceil(0.2 * n);
  const topShare = sorted.slice(0, topN).reduce((a, b) => a + b, 0) / Math.max(1, total);
  return { ks: list.map((e) => e.follows.length), incoming, total, topShare, mean: total / n };
}

describe("buildFollowGraph — degree heterogeneity", () => {
  const n = 40;
  const w = world("graph-hetero-1");
  const graph = buildFollowGraph(w, personas(n));
  const s = summarize(graph, n);

  it("keeps outgoing follow counts inside the existing [3, 7] bounds", () => {
    expect(graph.length).toBe(n);
    for (const e of graph) {
      expect(e.follows.length).toBeGreaterThanOrEqual(3);
      expect(e.follows.length).toBeLessThanOrEqual(7);
      expect(e.follows.length).toBeLessThanOrEqual(n - 1);
      expect(new Set(e.follows).size, "no duplicate follows").toBe(e.follows.length);
      expect(e.follows).not.toContain(e.personaId); // never follows self
    }
    // heterogeneous, not the old uniform 3..7 noise floor: several distinct counts
    expect(new Set(s.ks).size).toBeGreaterThanOrEqual(3);
  });

  it("places ~20% of personas in the zipf hub bucket (6-7 follows)", () => {
    const hubs = s.ks.filter((k) => k >= 6).length;
    const share = hubs / n;
    // zipf(1.8) over [3,7] puts p(k>=6) ≈ 0.198 — assert the draw matches
    expect(share).toBeGreaterThanOrEqual(0.1);
    expect(share).toBeLessThanOrEqual(0.35);
  });

  it("concentrates incoming follows via preferential attachment (~20% hold a disproportionate share)", () => {
    // uniform fan-out would give the top 20% exactly 20% of incoming follows
    expect(s.topShare).toBeGreaterThanOrEqual(0.3);
    // a clear hub exists: max in-degree at least ~1.75× the mean
    const maxIn = Math.max(...s.incoming);
    expect(maxIn).toBeGreaterThanOrEqual(Math.ceil(s.mean * 1.75));
    expect(maxIn).toBeGreaterThan(Math.min(...s.incoming));
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const again = buildFollowGraph(w, personas(n));
    expect(again).toEqual(graph);
    const other = buildFollowGraph(world("graph-hetero-2"), personas(n));
    expect(other).not.toEqual(graph);
  });

  it("stays compatible with the old two-argument signature and opts overrides", () => {
    const legacy = buildFollowGraph(world("graph-hetero-1"), personas(n)); // no opts — additive compat
    expect(legacy).toEqual(graph);
    const bounded = buildFollowGraph(w, personas(n), { minFollows: 2, maxFollows: 4 });
    for (const e of bounded) {
      expect(e.follows.length).toBeGreaterThanOrEqual(2);
      expect(e.follows.length).toBeLessThanOrEqual(4);
    }
  });
});
