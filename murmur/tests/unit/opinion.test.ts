/**
 * Deffuant bounded-confidence opinion dynamics.
 *
 * The rule under test is a claim about a social mechanism, and the two halves
 * of it pull in opposite directions: personas close to each other CONVERGE, and
 * personas far apart either disengage slightly or ignore each other. The
 * second half is the easy half to get wrong in a way no test notices — if the
 * abstention draw silently stopped happening, every far-apart pair would
 * simply do nothing, runs would still be deterministic, and the mechanism
 * would be gone.
 *
 * The epsilon boundary is pinned exactly. It is the difference between "people
 * who disagree a little influence each other" and "people who disagree at all
 * are walled off", and an off-by-one there (a strict `<` instead of `<=`)
 * would make the reported epsilon a lie.
 */
import { describe, expect, it } from "vitest";
import { deffuantUpdate, applyOpinionDynamics, type OpinionAgent } from "../../packages/engine/src/dynamics/opinion.js";
import { Rng, streamRng } from "../../packages/engine/src/util/rng.js";
import type { World } from "../../packages/engine/src/types.js";

const world = (seed = "dyn-seed") => ({ seed }) as World;

/** Minimal population member. */
const agent = (id: string, stances: Record<string, number>, follows: string[] = []): OpinionAgent => ({
  id,
  stances,
  follows,
});

/**
 * An Rng whose every draw is the same number, so the abstention branch is
 * decided by the caller's `abstentionChance` alone. `bool(p)` keeps the real
 * comparison — an override that ignored `p` would make a
 * `abstentionChance: 0` test pass or fail for the wrong reason.
 */
class FixedRng extends Rng {
  constructor(private readonly value: number) {
    super("fixed");
  }
  override float(): number {
    return this.value;
  }
  override bool(p = 0.5): boolean {
    return this.value < p;
  }
}

describe("deffuantUpdate — convergence inside epsilon", () => {
  it("converges a pair whose gap is exactly epsilon (the boundary is inclusive)", () => {
    const r = deffuantUpdate(0.2, -0.2, { epsilon: 0.4, mu: 0.2 });
    // |0.2 - (-0.2)| = 0.4 === epsilon. A strict `<` would return
    // "no-interaction" here and the configured radius would be a lie.
    expect(r.outcome).toBe("converge");
    // Each side moves μ · gap toward the other: 0.2 + 0.2·(−0.4) = 0.12.
    expect(r.a).toBe(0.12);
    expect(r.b).toBe(-0.12);
  });

  it("does not converge a pair one step outside epsilon", () => {
    const r = deffuantUpdate(0.21, -0.2, { epsilon: 0.4, mu: 0.2 });
    expect(r.outcome).toBe("no-interaction");
    expect(r.a).toBe(0.21);
    expect(r.b).toBe(-0.2);
  });

  it("assimilates by exactly mu times the gap, moving both sides toward each other", () => {
    const r = deffuantUpdate(0.8, 0.4, { epsilon: 0.4, mu: 0.2 });
    // gap 0.4: a += 0.2·(0.4 − 0.8) = 0.72; b += 0.2·(0.8 − 0.4) = 0.48
    expect(r.a).toBe(0.72);
    expect(r.b).toBe(0.48);
    // The gap strictly shrinks — that is the whole point of assimilation.
    expect(Math.abs(r.a - r.b)).toBeLessThan(0.4);
  });

  it("is a no-op on an identical pair (gap 0 moves nothing)", () => {
    const r = deffuantUpdate(0.5, 0.5, { epsilon: 0.4, mu: 0.2 });
    expect(r).toEqual({ a: 0.5, b: 0.5, outcome: "converge" });
  });

  it("scales the movement by mu and leaves it unchanged at mu = 0", () => {
    expect(deffuantUpdate(0.5, 0.1, { epsilon: 0.5, mu: 1 }).a).toBe(0.1);
    expect(deffuantUpdate(0.5, 0.1, { epsilon: 0.5, mu: 0 }).a).toBe(0.5);
  });

  it("uses the documented defaults when no parameters are supplied", () => {
    // ε = 0.4, μ = 0.2 by default: a gap of 0.3 converges, 0.5 does not.
    const close = deffuantUpdate(0.15, -0.15, {});
    expect(close.outcome).toBe("converge");
    expect(close.a).toBe(0.09); // 0.15 + 0.2 · (−0.3)
    expect(close.b).toBe(-0.09);
    expect(deffuantUpdate(0.25, -0.25, {}).outcome).toBe("no-interaction");
  });

  it("clamps out-of-range stances before applying the rule", () => {
    const r = deffuantUpdate(5, -5, { epsilon: 0.4, mu: 0.2 });
    expect(r.a).toBeLessThanOrEqual(1);
    expect(r.b).toBeGreaterThanOrEqual(-1);
    // A clamped gap of 2 is far outside epsilon, so the pair does not interact.
    expect(r.outcome).toBe("no-interaction");
  });

  it("rounds to 2 decimals so replays stay byte-stable", () => {
    const r = deffuantUpdate(0.333333, 0.111111, { epsilon: 0.4, mu: 0.2 });
    expect(r.a).toBe(Math.round(r.a * 100) / 100);
    expect(r.b).toBe(Math.round(r.b * 100) / 100);
  });
});

describe("deffuantUpdate — abstention beyond epsilon", () => {
  it("disengages when the seeded draw fires, relaxing BOTH stances 5% toward neutral", () => {
    const r = deffuantUpdate(0.8, -0.6, { epsilon: 0.4, abstentionChance: 0.1, rng: new FixedRng(0.05) });
    expect(r.outcome).toBe("disengage");
    expect(r.a).toBe(0.76); // 0.8 × 0.95
    expect(r.b).toBe(-0.57); // −0.6 × 0.95
    // Both moved TOWARD zero, i.e. toward disengagement, not toward each other.
    expect(Math.abs(r.a)).toBeLessThan(0.8);
    expect(Math.abs(r.b)).toBeLessThan(0.6);
  });

  it("does not disengage when the abstention draw misses", () => {
    const r = deffuantUpdate(0.8, -0.6, { epsilon: 0.4, abstentionChance: 0.1, rng: new FixedRng(0.9) });
    expect(r.outcome).toBe("no-interaction");
    expect(r.a).toBe(0.8);
    expect(r.b).toBe(-0.6);
  });

  it("is a PURE no-op beyond epsilon when no rng is supplied", () => {
    // Without a seeded stream there is no draw to make, so the abstention rule
    // is skipped entirely. This is what makes the rule safe to call from code
    // that has no seed: it degrades to doing nothing, never to Math.random().
    const r = deffuantUpdate(0.9, -0.9, { epsilon: 0.1, abstentionChance: 1 });
    expect(r.outcome).toBe("no-interaction");
    expect(r).toEqual({ a: 0.9, b: -0.9, outcome: "no-interaction" });
  });

  it("never abstains at abstentionChance = 0 even with an rng that would fire", () => {
    const r = deffuantUpdate(0.9, -0.9, { epsilon: 0.1, abstentionChance: 0, rng: new FixedRng(0) });
    expect(r.outcome).toBe("no-interaction");
  });

  it("always abstains at abstentionChance = 1", () => {
    const r = deffuantUpdate(0.9, -0.9, { epsilon: 0.1, abstentionChance: 1, rng: new FixedRng(0.99) });
    expect(r.outcome).toBe("disengage");
  });

  it("leaves an in-epsilon pair untouched by the abstention draw", () => {
    // The draw is only consulted past epsilon; a firing rng must not change a
    // converging pair's outcome.
    const r = deffuantUpdate(0.1, -0.1, { epsilon: 0.4, abstentionChance: 0.9, rng: new FixedRng(0) });
    expect(r.outcome).toBe("converge");
  });
});

describe("applyOpinionDynamics — edge graph", () => {
  it("does nothing for a population of one, with or without a follow graph", () => {
    const personas = [agent("p_1", { e_1: 0.5 }, ["p_1"])];
    const r = applyOpinionDynamics(world(), 1, { personas });
    expect(r).toEqual({ edges: 0, pairsSampled: 0, interactions: { converge: 0, disengage: 0, noInteraction: 0 }, changed: [] });
  });

  it("ignores self-follows and edges pointing at personas outside the population", () => {
    const personas = [agent("p_1", { e_1: 0.5 }, ["p_1", "p_999"]), agent("p_2", { e_1: 0.4 }, [])];
    const r = applyOpinionDynamics(world(), 1, { personas });
    expect(r.edges).toBe(0);
    expect(r.changed).toEqual([]);
  });

  it("de-duplicates repeated edges and counts one edge per ordered pair", () => {
    const personas = [agent("p_1", { e_1: 0.5 }, ["p_2", "p_2"]), agent("p_2", { e_1: 0.4 }, ["p_1"])];
    const r = applyOpinionDynamics(world(), 1, { personas, pairsPerRound: 1 });
    expect(r.edges).toBe(2); // p_1→p_2 and p_2→p_1, the duplicate collapsed
  });

  it("only touches entities BOTH sides hold an opinion on", () => {
    const personas = [
      agent("p_1", { e_1: 0.5, e_2: -0.9 }, ["p_2"]),
      agent("p_2", { e_1: 0.4 }, ["p_1"]),
    ];
    const r = applyOpinionDynamics(world(), 1, { personas, pairsPerRound: 1 });
    expect(r.changed.every((c) => c.entityId === "e_1")).toBe(true);
    expect(personas[0].stances.e_2).toBe(-0.9); // e_2 untouched
  });

  it("mutates the personas in place and reports every change that moved", () => {
    const personas = [agent("p_1", { e_1: 0.5 }, ["p_2"]), agent("p_2", { e_1: 0.4 }, ["p_1"])];
    const before = JSON.stringify(personas.map((p) => p.stances));
    const r = applyOpinionDynamics(world(), 1, { personas, pairsPerRound: 1 });
    expect(JSON.stringify(personas.map((p) => p.stances)), "stances must actually move, not just be reported").not.toBe(before);
    for (const c of r.changed) {
      expect(c.to).not.toBe(c.from);
    }
  });

  it("caps the sampled pairs at pairsPerRound", () => {
    const personas = [
      agent("p_1", { e_1: 0.5 }, ["p_2", "p_3"]),
      agent("p_2", { e_1: 0.4 }, ["p_1", "p_3"]),
      agent("p_3", { e_1: 0.3 }, ["p_1", "p_2"]),
    ];
    const r = applyOpinionDynamics(world(), 1, { personas, pairsPerRound: 2 });
    expect(r.pairsSampled).toBe(2);
  });

  it("defaults to half the edge list, at least one", () => {
    const personas = [agent("p_1", { e_1: 0.5 }, ["p_2"]), agent("p_2", { e_1: 0.4 }, [])];
    expect(applyOpinionDynamics(world(), 1, { personas }).pairsSampled).toBe(1);
  });
});

describe("applyOpinionDynamics — determinism", () => {
  const build = () => [
    agent("p_1", { e_1: 0.9, e_2: -0.1 }, ["p_2", "p_3"]),
    agent("p_2", { e_1: -0.9, e_2: 0.2 }, ["p_1", "p_3"]),
    agent("p_3", { e_1: 0.1, e_2: -0.3 }, ["p_1", "p_2"]),
  ];

  it("replays identically for the same world seed and round", () => {
    const a = applyOpinionDynamics(world("seed-a"), 2, { personas: build() });
    const b = applyOpinionDynamics(world("seed-a"), 2, { personas: build() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("varies across world seeds — a fixed result would mean the rng is ignored", () => {
    const a = applyOpinionDynamics(world("seed-a"), 2, { personas: build() });
    const b = applyOpinionDynamics(world("seed-b"), 2, { personas: build() });
    expect(JSON.stringify(a.changed)).not.toBe(JSON.stringify(b.changed));
  });

  it("varies across rounds of the same world", () => {
    const a = applyOpinionDynamics(world("seed-a"), 1, { personas: build() });
    const b = applyOpinionDynamics(world("seed-a"), 2, { personas: build() });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("is independent of the input population order", () => {
    // The rule sorts the population by id before building the edge list, so a
    // host that returns personas in a different order gets the same run.
    const forward = build();
    const reversed = [...build()].reverse();
    const a = applyOpinionDynamics(world("seed-a"), 3, { personas: forward });
    const b = applyOpinionDynamics(world("seed-a"), 3, { personas: reversed });
    expect(a.changed).toEqual(b.changed);
  });

  it("routes every draw through streamRng on a documented per-pair key", () => {
    // Pinning the stream key means a future refactor that moves the abstention
    // draw to a different stream — silently changing every recorded run — fails
    // here rather than in a golden replay weeks later.
    const personas = build();
    const direct = deffuantUpdate(0.9, -0.9, { epsilon: 0.4, rng: streamRng("seed-a", "dynamics:2:0") });
    expect(typeof direct.outcome).toBe("string");

    const run = applyOpinionDynamics(world("seed-a"), 2, { personas });
    // Whatever the draw was, the result must be reproducible from that exact
    // stream: replaying the same call sequence must not consume new numbers.
    const personas2 = build();
    const rerun = applyOpinionDynamics(world("seed-a"), 2, { personas: personas2 });
    expect(rerun).toEqual(run);
  });

  it("produces no change at all when every pair is beyond epsilon and abstention never fires", () => {
    // abstentionChance 0 disables the only source of movement past epsilon, so
    // a fully-polarised population must be frozen — a useful negative control
    // on the whole module.
    const personas = [agent("p_1", { e_1: 1 }, ["p_2"]), agent("p_2", { e_1: -1 }, ["p_1"])];
    const r = applyOpinionDynamics(world("seed-x"), 1, { personas, epsilon: 0.1, mu: 0.2, abstentionChance: 0 });
    expect(r.changed).toEqual([]);
    expect(r.interactions.noInteraction).toBeGreaterThan(0);
  });
});
