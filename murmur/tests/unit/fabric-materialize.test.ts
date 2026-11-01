/**
 * Lazy persona materialization — one persona at a time, zero LLM.
 *
 * Pinned: the same persona id interviewed twice returns identical output;
 * across 100 ids the outputs genuinely vary; a same-seed refabrication
 * reproduces the view exactly; claims without a fitted head are labeled
 * UNCALIBRATED; and the rationale is assembled from archetype + dominant
 * traits + model weights, never generated.
 */
import { describe, expect, it } from "vitest";
import {
  TRAIT_COUNT,
  appendMemory,
  fabricate,
  fit as fitSurrogate,
  lazyPersona,
  mulberry32,
  type FabricExample,
} from "@murmur/engine";

function examples(count = 500): FabricExample[] {
  const rng = mulberry32(31337);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const traits = Array.from({ length: TRAIT_COUNT }, () => rng());
    const price = traits[0];
    out.push({
      traits,
      claimId: "licensing-change",
      support: price < 0.5 ? 1 : 0,
      objectionId: price > 0.7 ? "too_expensive" : "lock_in",
      choiceId: price > 0.5 ? "switch" : "stay",
    });
  }
  return out;
}

const setup = () => {
  const population = fabricate({ count: 200, seed: "materialize-seed" });
  const { model } = fitSurrogate(examples(), { seed: "materialize-fit" });
  return { population, model };
};

describe("lazy materialization", () => {
  it("returns the identical view for the same persona id and claim", () => {
    const { population, model } = setup();
    const a = lazyPersona(population, model, "#42", "licensing-change");
    const b = lazyPersona(population, model, "#42", "licensing-change");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Same persona by bare number too — "#42" and 42 address one persona.
    expect(JSON.stringify(lazyPersona(population, model, 42, "licensing-change"))).toBe(
      JSON.stringify(a),
    );
  });

  it("varies across 100 different persona ids", () => {
    const { population, model } = setup();
    const views = Array.from({ length: 100 }, (_, i) =>
      lazyPersona(population, model, `#${i}`, "licensing-change"),
    );
    const distinct = new Set(views.map((v) => JSON.stringify(v)));
    expect(distinct.size).toBeGreaterThan(1);
    expect(new Set(views.map((v) => v.stance)).size).toBeGreaterThan(1);
    expect(new Set(views.map((v) => v.archetype)).size).toBeGreaterThan(1);
  });

  it("reproduces the view from a same-seed refabrication", () => {
    const { model } = setup();
    const first = lazyPersona(
      fabricate({ count: 200, seed: "materialize-seed" }),
      model,
      "#7",
      "licensing-change",
    );
    const second = lazyPersona(
      fabricate({ count: 200, seed: "materialize-seed" }),
      model,
      "#7",
      "licensing-change",
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("labels a claim without a fitted head UNCALIBRATED", () => {
    const { population, model } = setup();
    const view = lazyPersona(population, model, "#3", "unknown-claim");
    expect(view.calibration).toBe("uncalibrated");
    expect(view.stance).toBe(0);
    expect(view.rationale).toContain("UNCALIBRATED");
    const pooled = lazyPersona(population, model, "#3");
    expect(pooled.claimId).toBeNull();
    expect(pooled.calibration).toBe("calibrated"); // pooled head exists
  });

  it("assembles the rationale from archetype, traits and model weights", () => {
    const { population, model } = setup();
    const view = lazyPersona(population, model, "#12", "licensing-change");
    expect(view.personaId).toBe("#12");
    expect(Object.keys(view.traits)).toHaveLength(TRAIT_COUNT);
    expect(view.rationale).toContain("Surrogate persona #12");
    expect(view.rationale).toContain(view.archetype);
    expect(view.rationale).toMatch(/Dominant traits: (high|low) \w+ \(/);
    expect(view.rationale).toMatch(/weight [+-]\d+\.\d{2} pushes (support|oppose)/);
    expect(view.rationale).toContain("intensity");
  });

  it("rejects persona references outside the population", () => {
    const { population, model } = setup();
    expect(() => lazyPersona(population, model, "#200", "c")).toThrow(/personaId/);
    expect(() => lazyPersona(population, model, "abc", "c")).toThrow(/personaId/);
  });

  it("references persona memory when the log holds prior statements", () => {
    const { population, model } = setup();
    const bare = lazyPersona(population, model, "#5", "licensing-change");
    expect(bare.memory).toEqual([]);
    expect(bare.rationale).not.toContain("Previously stated");

    const log = appendMemory([], 5, "I would pay at most $20 a month");
    const withMemory = lazyPersona(
      population,
      model,
      "#5",
      "licensing-change",
      log,
    );
    expect(withMemory.memory).toHaveLength(1);
    expect(withMemory.memory[0].text).toBe("I would pay at most $20 a month");
    expect(withMemory.rationale).toContain("Previously stated");
    expect(withMemory.rationale).toContain("I would pay at most $20 a month");
    // Memory does not change the model's stance — it changes the narrative.
    expect(withMemory.stance).toBe(bare.stance);
  });
});
