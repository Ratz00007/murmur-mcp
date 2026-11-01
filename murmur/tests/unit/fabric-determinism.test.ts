/**
 * Fabric determinism/replay — the Phase B core contract.
 *
 * Same spec ⇒ byte-identical population and byte-identical aggregates, with
 * no unseeded randomness anywhere in the path. Also pinned: per-persona
 * seeding means persona #i is stable as the population grows, so a spec that
 * round-trips through JSON replays identically.
 */
import { describe, expect, it } from "vitest";
import {
  FABRIC_ARCHETYPES,
  MAX_FABRIC_POPULATION,
  TRAIT_COUNT,
  TRAIT_KEYS,
  fabricate,
  fit as fitSurrogate,
  massEvaluate,
  mulberry32,
  type FabricExample,
} from "@murmur/engine";

/** Deterministic labeled examples for aggregate-replay checks. */
function makeExamples(count: number): FabricExample[] {
  const rng = mulberry32(20261101);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const t = Array.from({ length: TRAIT_COUNT }, () => rng());
    // Separable stance: cheap-sensitive personas support the discount claim.
    out.push({
      traits: t,
      claimId: "replay-claim",
      support: t[0] < 0.5 ? 1 : 0,
      objectionId: t[0] > 0.7 ? "too_expensive" : "lock_in",
      choiceId: t[2] > 0.8 ? "fork" : t[2] > 0.4 ? "stay" : "switch",
    });
  }
  return out;
}

describe("fabric determinism and replay", () => {
  it("fabricates byte-identical typed arrays for the same seed", () => {
    const a = fabricate({ count: 5000, seed: "replay-alpha" });
    const b = fabricate({ count: 5000, seed: "replay-alpha" });
    expect(a.count).toBe(b.count);
    for (let k = 0; k < TRAIT_COUNT; k++) {
      expect(Buffer.from(a.traits[k].buffer)).toEqual(
        Buffer.from(b.traits[k].buffer),
      );
    }
    expect(Buffer.from(a.archetype.buffer)).toEqual(
      Buffer.from(b.archetype.buffer),
    );
    expect(Buffer.from(a.personaSeed.buffer)).toEqual(
      Buffer.from(b.personaSeed.buffer),
    );
  });

  it("produces byte-identical aggregate JSON across independent replay", () => {
    const run = () => {
      const pop = fabricate({ count: 2000, seed: "replay-beta" });
      const { model } = fitSurrogate(makeExamples(400), { seed: "replay-fit" });
      return JSON.stringify(
        massEvaluate(model, pop, [
          { id: "replay-claim" },
          { id: "unheard-claim" },
        ]),
      );
    };
    expect(run()).toBe(run());
  });

  it("yields different populations for different seeds", () => {
    const a = fabricate({ count: 500, seed: "seed-one" });
    const b = fabricate({ count: 500, seed: "seed-two" });
    let same = true;
    for (let i = 0; i < a.count && same; i++) {
      for (let k = 0; k < TRAIT_COUNT; k++) {
        if (a.traits[k][i] !== b.traits[k][i]) {
          same = false;
          break;
        }
      }
    }
    expect(same).toBe(false);
  });

  it("keeps persona #i identical as the population grows (per-persona seeds)", () => {
    const small = fabricate({ count: 100, seed: "grow" });
    const large = fabricate({ count: 100_000, seed: "grow" });
    for (let i = 0; i < 100; i++) {
      expect(large.personaSeed[i]).toBe(small.personaSeed[i]);
      for (let k = 0; k < TRAIT_COUNT; k++) {
        expect(large.traits[k][i]).toBe(small.traits[k][i]);
      }
    }
  });

  it("replays byte-identically from a spec that round-tripped through JSON", () => {
    const spec = {
      count: 1500,
      seed: "json-roundtrip",
      archetypeWeights: { oss_maintainer: 3, lurker: 1, evangelist: 0.5 },
    };
    const revived = JSON.parse(JSON.stringify(spec)) as typeof spec;
    const a = fabricate(spec);
    const b = fabricate(revived);
    for (let k = 0; k < TRAIT_COUNT; k++) {
      expect(Buffer.from(a.traits[k].buffer)).toEqual(
        Buffer.from(b.traits[k].buffer),
      );
    }
  });

  it("traits stay in [0,1] and archetype ids are valid for a large run", () => {
    const pop = fabricate({ count: 50_000, seed: "range-check" });
    let bad = 0;
    for (let k = 0; k < TRAIT_COUNT; k++) {
      for (let i = 0; i < pop.count; i++) {
        const v = pop.traits[k][i];
        if (!(v >= 0 && v <= 1) || !Number.isFinite(v)) bad++;
      }
    }
    expect(bad).toBe(0);
    for (let i = 0; i < pop.count; i++) {
      if (pop.archetype[i] >= FABRIC_ARCHETYPES.length) bad++;
    }
    expect(bad).toBe(0);
  });

  it("rejects out-of-range counts and unknown archetype weights", () => {
    expect(() => fabricate({ count: 0, seed: "s" })).toThrow(/count/);
    expect(() => fabricate({ count: MAX_FABRIC_POPULATION + 1, seed: "s" }))
      .toThrow(/count/);
    expect(() => fabricate({ count: 10.5, seed: "s" })).toThrow(/count/);
    expect(() =>
      fabricate({
        count: 10,
        seed: "s",
        archetypeWeights: { not_an_archetype: 1 },
      }),
    ).toThrow(/unknown archetype/);
    expect(() =>
      fabricate({ count: 10, seed: "s", archetypeWeights: { lurker: -1 } }),
    ).toThrow(/weight/);
  });

  it("exposes the fabric surface through the engine root export", () => {
    // The engine index re-exports fabric via `export *` — a name collision
    // there would silently drop names, so the root import itself is the tripwire.
    expect(TRAIT_KEYS).toHaveLength(10);
    expect(FABRIC_ARCHETYPES).toHaveLength(8);
    expect(MAX_FABRIC_POPULATION).toBe(1_000_000);
  });
});
