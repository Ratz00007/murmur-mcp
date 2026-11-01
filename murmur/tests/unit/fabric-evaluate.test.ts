/**
 * Mass evaluation at scale — 1,000,000 personas × 3 claims.
 *
 * The engine contract is "well under 5 seconds in typed-array passes with no
 * allocations per persona". The timing ceiling here is deliberately generous
 * (5000ms) because Windows CI runs tests in parallel and wall-clock jitter is
 * real; the assertion exists to catch algorithmic regressions (per-persona
 * object churn, per-persona allocation), not to measure speed. Distributions
 * are checked for validity: counts sum to N, shares stay in [0,1], and the
 * honesty block rides on the result.
 */
import { describe, expect, it } from "vitest";
import {
  TRAIT_COUNT,
  fabricate,
  fit as fitSurrogate,
  massEvaluate,
  mulberry32,
  SURROGATE_DISCLAIMER,
  type FabricExample,
} from "@murmur/engine";

const POPULATION = 1_000_000;

/** Separable examples across two claims + one migration head. */
function examples(count = 600): FabricExample[] {
  const rng = mulberry32(777);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const traits = Array.from({ length: TRAIT_COUNT }, () => rng());
    const price = traits[0];
    const loyalty = traits[2];
    out.push({
      traits,
      claimId: i % 2 === 0 ? "claim-a" : "claim-b",
      support: price < 0.5 ? 1 : 0,
      objectionId: price > 0.75 ? "too_expensive" : "lock_in",
      choiceId: loyalty > 0.75 ? "fork" : loyalty > 0.4 ? "stay" : "switch",
    });
  }
  return out;
}

describe("massEvaluate at 1M personas", () => {
  const pop = fabricate({ count: POPULATION, seed: "mass-scale" });
  const { model } = fitSurrogate(examples(), { seed: "mass-fit" });

  it("evaluates 1M personas × 3 claims in under 5000ms (generous CI ceiling)", () => {
    const claims = [
      { id: "claim-a" },
      { id: "claim-b" },
      { id: "claim-uncalibrated" },
    ];
    const t0 = performance.now();
    const evaluation = massEvaluate(model, pop, claims);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(5000);
    expect(evaluation.claims).toHaveLength(3);
  });

  it("produces valid distributions and the honesty block", () => {
    const evaluation = massEvaluate(model, pop, [
      { id: "claim-a" },
      { id: "claim-b" },
      { id: "claim-uncalibrated" },
    ]);
    expect(evaluation.personaCount).toBe(POPULATION);

    for (const claim of evaluation.claims) {
      if (!claim.calibrated) {
        // No fitted head: zero counts by design, no objection histogram.
        expect(claim.stance).toEqual({ support: 0, neutral: 0, oppose: 0 });
        expect(claim.objectionHistogram).toEqual([]);
        continue;
      }
      const { support, neutral, oppose } = claim.stance;
      expect(support + neutral + oppose).toBe(POPULATION);
      const shareSum =
        claim.stanceShares.support +
        claim.stanceShares.neutral +
        claim.stanceShares.oppose;
      expect(shareSum).toBeGreaterThan(0.99999);
      expect(shareSum).toBeLessThanOrEqual(1.00001);
      for (const s of Object.values(claim.stanceShares)) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
      expect(claim.meanStance).toBeGreaterThanOrEqual(-1);
      expect(claim.meanStance).toBeLessThanOrEqual(1);
      expect(claim.polarization).toBeGreaterThanOrEqual(0);
      expect(claim.polarization).toBeLessThanOrEqual(1);
      const objectionTotal = claim.objectionHistogram.reduce(
        (acc, h) => acc + h.count,
        0,
      );
      expect(objectionTotal).toBe(POPULATION);
    }

    // Fitted claims are calibrated; the unheard-of one is not.
    expect(evaluation.claims[0].calibrated).toBe(true);
    expect(evaluation.claims[1].calibrated).toBe(true);
    expect(evaluation.claims[2].calibrated).toBe(false);
    expect(evaluation.claims[2].stance.support).toBe(0);
    expect(evaluation.claims[2].objectionHistogram).toEqual([]);

    // Migration shares: every persona chose exactly one option.
    const migrationTotal = evaluation.migrationShares.reduce(
      (acc, m) => acc + m.count,
      0,
    );
    expect(migrationTotal).toBe(POPULATION);
    const migrationShareSum = evaluation.migrationShares.reduce(
      (acc, m) => acc + m.share,
      0,
    );
    expect(migrationShareSum).toBeGreaterThan(0.99999);

    // Honesty block: personaCount + surrogate metrics + exact disclaimer.
    expect(evaluation.honesty).toEqual({
      personaCount: POPULATION,
      surrogate: {
        holdoutAccuracy: model.metrics.holdoutAccuracy,
        labeledCount: 600,
        effectiveSampleSize: 600,
      },
      disclaimer: SURROGATE_DISCLAIMER,
    });
    expect(evaluation.honesty.disclaimer).toBe(
      "surrogate personas — a compressed model of labeled opinions, not data about real people",
    );
  });

  it("reports a model-less evaluation as fully UNCALIBRATED", () => {
    const evaluation = massEvaluate(null, pop, [
      { id: "claim-a" },
      { id: "claim-b" },
    ]);
    for (const claim of evaluation.claims) {
      expect(claim.calibrated).toBe(false);
      expect(claim.stance).toEqual({ support: 0, neutral: 0, oppose: 0 });
      expect(claim.objectionHistogram).toEqual([]);
    }
    expect(evaluation.migrationShares).toEqual([]);
    expect(evaluation.honesty.surrogate.labeledCount).toBe(0);
    expect(evaluation.honesty.disclaimer).toBe(SURROGATE_DISCLAIMER);
  });

  it("rejects duplicate and empty claim ids", () => {
    expect(() => massEvaluate(model, pop, [])).toThrow(/at least one claim/);
    expect(() =>
      massEvaluate(model, pop, [{ id: "x" }, { id: "x" }]),
    ).toThrow(/duplicate claim id/);
  });
});
