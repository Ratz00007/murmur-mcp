/**
 * Surrogate fit/predict — the compressed-opinion model.
 *
 * Fit is deterministic full-batch gradient descent; the assertions pin the
 * learning behavior (separable data reaches high holdout accuracy), the
 * metrics contract (the six fields the honesty block publishes), the
 * serialization round-trip, and the UNCALIBRATED path when no support
 * labels exist for a claim.
 */
import { describe, expect, it } from "vitest";
import {
  TRAIT_COUNT,
  fit as fitSurrogate,
  modelFromJson,
  modelToJson,
  predict,
  mulberry32,
  type FabricExample,
  type SurrogateModel,
} from "@murmur/engine";

const KEYS = [
  "priceSensitivity",
  "lockInAversion",
  "ossLoyalty",
  "switchingCost",
  "socialInfluence",
  "riskAversion",
  "platformFluidity",
  "cynicism",
  "detailOrientation",
  "communityCentrality",
] as const;

/** 600 cleanly separable examples: support ⟺ low priceSensitivity. */
function separableExamples(count = 600): FabricExample[] {
  const rng = mulberry32(424242);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const traits = Array.from({ length: TRAIT_COUNT }, () => rng());
    const price = traits[0];
    const loyalty = traits[2];
    out.push({
      traits,
      claimId: "price-hike",
      support: price < 0.5 ? 1 : 0,
      objectionId: price > 0.75 ? "too_expensive" : "budget_creep",
      choiceId: loyalty > 0.75 ? "fork" : loyalty > 0.4 ? "stay" : "switch",
    });
  }
  return out;
}

function traitsOf(t: Partial<Record<(typeof KEYS)[number], number>>): number[] {
  return KEYS.map((k) => t[k] ?? 0.5);
}

describe("surrogate fit and predict", () => {
  it("reaches holdoutAccuracy > 0.8 on separable data", () => {
    const { model, metrics } = fitSurrogate(separableExamples(), {
      seed: "unit-fit-1",
      holdoutFraction: 0.2,
    });
    expect(metrics.holdoutAccuracy).toBeGreaterThan(0.8);
    expect(metrics.holdoutN).toBeGreaterThan(0);
    expect(metrics.holdoutN).toBeLessThan(600);
    expect(model.pooledStance).not.toBeNull();
    expect(model.claims["price-hike"]).toBeDefined();
  });

  it("reports sane metrics with the exact six-field contract", () => {
    const { metrics } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    expect(metrics.labeledCount).toBe(600);
    expect(metrics.effectiveSampleSize).toBe(metrics.labeledCount);
    expect(metrics.holdoutN).toBeGreaterThan(0);
    expect(metrics.holdoutAccuracy).toBeGreaterThan(0.8);
    expect(metrics.holdoutAccuracy).toBeLessThanOrEqual(1);
    expect(metrics.macroF1).toBeGreaterThan(0.8);
    expect(metrics.macroF1).toBeLessThanOrEqual(1);
    expect(metrics.logLoss).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(metrics.logLoss)).toBe(true);
    // Exact field set — the honesty block prints these, nothing else.
    expect(Object.keys(metrics).sort()).toEqual(
      [
        "effectiveSampleSize",
        "holdoutAccuracy",
        "holdoutN",
        "labeledCount",
        "logLoss",
        "macroF1",
      ].sort(),
    );
  });

  it("fits identically twice — same examples, same options, same model JSON", () => {
    const examples = separableExamples();
    const a = fitSurrogate(examples, { seed: "unit-fit-1" });
    const b = fitSurrogate(examples, { seed: "unit-fit-1" });
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(b.model));
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
  });

  it("predicts support for cheap-sensitive and oppose for price-blind personas", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const low = predict(model, traitsOf({ priceSensitivity: 0.05 }), "price-hike");
    const high = predict(model, traitsOf({ priceSensitivity: 0.95 }), "price-hike");
    expect(low.stance).toBeGreaterThan(0);
    expect(high.stance).toBeLessThan(0);
    for (const p of [low, high]) {
      expect(p.stance).toBeGreaterThanOrEqual(-1);
      expect(p.stance).toBeLessThanOrEqual(1);
      expect(p.intensity).toBeGreaterThanOrEqual(0);
      expect(p.intensity).toBeLessThanOrEqual(1);
      expect(p.intensity).toBeCloseTo(Math.abs(p.stance), 6);
      expect(p.calibration).toBe("calibrated");
    }
  });

  it("routes objections through the per-claim softmax head", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const expensive = predict(
      model,
      traitsOf({ priceSensitivity: 0.95 }),
      "price-hike",
    );
    const mild = predict(
      model,
      traitsOf({ priceSensitivity: 0.1 }),
      "price-hike",
    );
    // The training data ties "too_expensive" to price > 0.75 — the model's
    // argmax follows the trait it learned to read.
    expect(expensive.topObjectionId).toBe("too_expensive");
    expect(["too_expensive", "budget_creep"]).toContain(mild.topObjectionId);
  });

  it("routes migration choice through the global softmax head", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const forker = predict(model, traitsOf({ ossLoyalty: 0.98 }));
    const switcher = predict(model, traitsOf({ ossLoyalty: 0.02 }));
    expect(forker.migrationChoiceId).toBe("fork");
    expect(switcher.migrationChoiceId).toBe("switch");
  });

  it("predicts from the pooled head when no claim is given", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const p = predict(model, traitsOf({ priceSensitivity: 0.02 }));
    expect(p.calibration).toBe("calibrated");
    expect(p.stance).toBeGreaterThan(0);
    expect(p.topObjectionId).toBeNull(); // objections are claim-scoped
  });

  it("marks predictions UNCALIBRATED when no head covers the claim", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const p = predict(model, traitsOf({}), "never-heard-of-it");
    expect(p.calibration).toBe("uncalibrated");
    expect(p.stance).toBe(0);
    expect(p.intensity).toBe(0);
  });

  it("trains no stance head and reports zero quality without support labels", () => {
    const examples: FabricExample[] = separableExamples(120).map((ex) => ({
      traits: ex.traits,
      claimId: ex.claimId,
      objectionId: ex.objectionId,
      choiceId: ex.choiceId,
    }));
    const { model, metrics } = fitSurrogate(examples, { seed: "no-stance" });
    expect(model.pooledStance).toBeNull();
    expect(model.claims["price-hike"]?.stance.weights.every((w) => w === 0)).toBe(
      true,
    );
    expect(metrics.holdoutAccuracy).toBe(0);
    expect(metrics.labeledCount).toBe(120);
  });

  it("round-trips through JSON without changing a single prediction", () => {
    const { model } = fitSurrogate(separableExamples(), { seed: "unit-fit-1" });
    const revived = modelFromJson(
      JSON.parse(JSON.stringify(modelToJson(model))) as unknown,
    ) as SurrogateModel;
    expect(JSON.stringify(revived)).toBe(JSON.stringify(model));
    const v = traitsOf({ priceSensitivity: 0.3, ossLoyalty: 0.9 });
    expect(predict(revived, v, "price-hike")).toEqual(
      predict(model, v, "price-hike"),
    );
  });

  it("rejects malformed examples and malformed model JSON", () => {
    expect(() => fitSurrogate([], { seed: "s" })).toThrow(/at least one/);
    expect(() =>
      fitSurrogate([{ traits: [0.1, 0.2], support: 1 }], { seed: "s" }),
    ).toThrow(/traits array/);
    expect(() =>
      fitSurrogate([{ traits: traitsOf({}), claimId: "c", support: 0.5 }], { seed: "s" }),
    ).toThrow(/support/);
    expect(() => fitSurrogate([{ traits: traitsOf({}) }], { seed: "s" })).toThrow(
      /no labeled examples/,
    );
    expect(() => modelFromJson({ format: "nope" })).toThrow(/format\/version/);
    expect(() =>
      modelFromJson(
        JSON.parse(
          JSON.stringify({
            ...modelToJson(fitSurrogate(separableExamples(8), { seed: "s" }).model),
            traitKeys: ["a", "b"],
          }),
        ) as unknown,
      ),
    ).toThrow(/traitKeys/);
  });
});
