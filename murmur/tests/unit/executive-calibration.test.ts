/**
 * Phase D calibration tests — executive models fit against externally
 * observed outcomes.
 *
 * Data source: bench/data-outcomes/observed-outcomes.json at the repository
 * root (loaded with fs, relative to THIS test file — tests may read repo
 * files; the engine module itself stays pure: no fs, no network, no
 * Date.now). All assertions run offline.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXECUTIVE_PARAMS,
  EXECUTIVE_PARAM_BOUNDS,
  applyCalibration,
  destinationShares,
  fitExecutiveParams,
  leaveOneOutErrors,
  predictedChurnShare,
  type ExecutiveCalibration,
  type ObservedOutcomes,
} from "../../packages/engine/src/calibrate/executive-calibration.js";
import { computeCompetitorMigration, computeExecutiveARRRisk } from "@murmur/engine";

const DATA_URL = new URL("../../../bench/data-outcomes/observed-outcomes.json", import.meta.url);
/** Injected clock — the fit must never read Date.now() (determinism). */
const CLOCK = "2026-11-01T00:00:00.000Z";

function loadObservations(): ObservedOutcomes {
  return JSON.parse(readFileSync(fileURLToPath(DATA_URL), "utf8")) as ObservedOutcomes;
}

describe("executive-calibration (Phase D)", () => {
  it("fits deterministically — identical input and clock return identical JSON", () => {
    const obs = loadObservations();
    const a = fitExecutiveParams(obs, CLOCK);
    const b = fitExecutiveParams(obs, CLOCK);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.calibratedAt).toBe(CLOCK);
    expect(a.status).toBe("calibrated");
  });

  it("reports a finite fit error over the 13 scored targets", () => {
    const fit = fitExecutiveParams(loadObservations(), CLOCK);
    expect(Number.isFinite(fit.fitError)).toBe(true);
    expect(fit.fitError).toBeGreaterThanOrEqual(0);
    // 4 churn/hazard targets + 9 migration targets marked usedInFit in the data file.
    expect(fit.observationCount).toBe(13);
    expect(fit.perCaseResiduals).toHaveLength(13);
    for (const r of fit.perCaseResiduals) {
      expect(Number.isFinite(r.predicted)).toBe(true);
      expect(Number.isFinite(r.residual)).toBe(true);
      expect(["high", "medium", "low"]).toContain(r.confidence);
    }
  });

  it("keeps fitted parameters inside the declared search box and actually moves from the defaults", () => {
    const fit = fitExecutiveParams(loadObservations(), CLOCK);
    for (const key of Object.keys(EXECUTIVE_PARAM_BOUNDS) as Array<keyof typeof EXECUTIVE_PARAM_BOUNDS>) {
      const bound = EXECUTIVE_PARAM_BOUNDS[key];
      expect(fit.params[key]).toBeGreaterThanOrEqual(bound.min);
      expect(fit.params[key]).toBeLessThanOrEqual(bound.max);
    }
    // The hand-set defaults leave a ~0.23 share miss on one Redis destination,
    // so a fit consistent with the data cannot be identical to the defaults.
    expect(fit.params).not.toEqual(DEFAULT_EXECUTIVE_PARAMS);
  });

  it("leaveOneOutErrors returns one entry per case, deterministically, with honest notes", () => {
    const obs = loadObservations();
    const a = leaveOneOutErrors(obs, CLOCK);
    const b = leaveOneOutErrors(obs, CLOCK);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(4);
    for (const loo of a) {
      expect(Number.isFinite(loo.rmse)).toBe(true);
      expect(loo.rmse).toBeGreaterThanOrEqual(0);
      expect(loo.targetsScored).toBeGreaterThan(0);
      expect(loo.note).toMatch(/holdout shares the corpus/);
    }
    const ids = a.map((x) => x.caseId).sort();
    expect(ids).toEqual([
      "docker-hub-free-team-2023",
      "hashicorp-bsl-2023",
      "redis-licensing-pivot-2024",
      "unity-runtime-fee-2023",
    ]);
  });

  it("applyCalibration overlays fitted params and keeps current values otherwise", () => {
    const fit = fitExecutiveParams(loadObservations(), CLOCK);
    const effective = applyCalibration(DEFAULT_EXECUTIVE_PARAMS, fit);
    expect(effective).toEqual(fit.params);
    // A calibration carrying only params: everything it provides wins,
    // everything it omits stays at the current value.
    const partial: Pick<ExecutiveCalibration, "params"> = {
      params: { ...DEFAULT_EXECUTIVE_PARAMS, hazardSlope: 9 },
    };
    expect(applyCalibration(DEFAULT_EXECUTIVE_PARAMS, partial)).toEqual({
      ...DEFAULT_EXECUTIVE_PARAMS,
      hazardSlope: 9,
    });
  });

  it("prediction helpers reproduce the hand-set model at the defaults", () => {
    // hazard(0.5) = 0.5 by construction; churn branch multiplies by 0.18.
    expect(predictedChurnShare(0.5, DEFAULT_EXECUTIVE_PARAMS)).toBeCloseTo(0.09, 12);
    const identical = [
      { name: "A", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
      { name: "B", isOSS: true, featureParity: 0.8, switchingFriction: 0.3 },
    ];
    const shares = destinationShares(identical, DEFAULT_EXECUTIVE_PARAMS);
    expect(shares.get("A")).toBeCloseTo(shares.get("B")!, 12);
  });
});

describe("report-executive integration (additive calibration hook)", () => {
  // Representative expectations copied from the pre-change behavior
  // (murmu/tests/unit/report-executive.test.ts uses the same fixtures).
  const totalARR = 50_000_000;

  it("without calibration: byte-identical numbers plus 'hand-set (uncalibrated)' status", () => {
    // Hand-computed from hazard = 1/(1+exp(-4*(0.75-0.5))):
    const risk = computeExecutiveARRRisk(totalARR, 0.75, 0.15);
    expect(risk.grossARRAtRisk).toBe(16_448_818); // round(50e6 * 0.7310585786300049 * 0.45)
    expect(risk.expectedChurnLossARR).toBe(7_500_000); // max(0.15, hazard*0.18) -> 0.15
    expect(risk.p90CaseLoss).toBe(12_375_000);
    expect(risk.mitigatedCaseLoss).toBe(2_625_000);
    expect(risk.netARRWaterfall.map((s) => s.balance)).toEqual([
      50_000_000, 42_500_000, 39_500_000, 44_375_000,
    ]);
    expect(risk.netARRWaterfall.map((s) => s.deltaARR)).toEqual([0, -7_500_000, -3_000_000, 4_875_000]);
    expect(risk.calibrationStatus).toBe("hand-set (uncalibrated)");

    const zero = computeExecutiveARRRisk(0, 0.9, 0.5);
    expect(zero.calibrationStatus).toBe("hand-set (uncalibrated)");
    expect(zero.grossARRAtRisk).toBe(0);
  });

  it("without calibration: migration shares match the hand-set multinomial logit", () => {
    const competitors = [
      { name: "Godot Engine", isOSS: true, featureParity: 0.85, switchingFriction: 0.3 },
      { name: "Unreal Engine", isOSS: false, featureParity: 0.95, switchingFriction: 0.6 },
      { name: "Custom In-House", isOSS: true, featureParity: 0.5, switchingFriction: 0.8 },
    ];
    const migration = computeCompetitorMigration(12_000_000, 1500, competitors);
    // U = 1.5*isOSS + 2.0*parity - 1.2*friction -> utilities (2.84, 1.18, 1.54),
    // softmax temperature 1 after max-subtraction — mirrored here explicitly:
    const utils = [
      1.5 * 1 + 2.0 * 0.85 - 1.2 * 0.3,
      2.0 * 0.95 - 1.2 * 0.6,
      1.5 * 1 + 2.0 * 0.5 - 1.2 * 0.8,
    ];
    const maxU = Math.max(...utils);
    const exps = utils.map((u) => Math.exp(u - maxU));
    const expSum = exps.reduce((a, b) => a + b, 0);
    expect(migration.map((m) => m.inflowSharePercent)).toEqual(
      exps.map((e) => Math.round((e / expSum) * 1000) / 10),
    );
    expect(migration.map((m) => m.inflowSharePercent)).toEqual([68.4, 13.0, 18.6]);
    expect(migration.map((m) => m.migratedAccounts)).toEqual(
      exps.map((e) => Math.round(1500 * (e / expSum))),
    );
    expect(migration.map((m) => m.migratedAccounts)).toEqual([1026, 195, 279]);
    for (const m of migration) {
      expect(m.calibrationStatus).toBe("hand-set (uncalibrated)");
      // ARR and accounts derive from the same share: they stay proportional.
      expect(Math.abs(m.migratedARR - m.migratedAccounts * 8000)).toBeLessThanOrEqual(8000);
    }
    expect(computeCompetitorMigration(12_000_000, 1500, [])).toEqual([]);
    const single = computeCompetitorMigration(12_000_000, 1500, [competitors[0]]);
    expect(single[0].inflowSharePercent).toBe(100.0);
    expect(single[0].calibrationStatus).toBe("hand-set (uncalibrated)");
  });

  it("with calibration: status propagates and invariants still hold", () => {
    const calibration = fitExecutiveParams(loadObservations(), CLOCK);
    const risk = computeExecutiveARRRisk(totalARR, 0.85, 0.05, { calibration });
    expect(risk.calibrationStatus).toBe(
      `calibrated (fit from ${calibration.observationCount} observations, RMSE ${calibration.fitError.toFixed(4)})`,
    );
    expect(risk.calibrationStatus).toMatch(/^calibrated \(fit from 13 observations, RMSE /);
    expect(risk.baseCaseLoss).toBeLessThanOrEqual(totalARR);
    expect(risk.p90CaseLoss).toBeLessThanOrEqual(totalARR);
    let running = risk.netARRWaterfall[0].balance;
    for (let i = 1; i < risk.netARRWaterfall.length; i++) {
      running += risk.netARRWaterfall[i].deltaARR;
      expect(risk.netARRWaterfall[i].balance).toBe(running);
    }

    const migration = computeCompetitorMigration(12_000_000, 1500, [
      { name: "Godot Engine", isOSS: true, featureParity: 0.85, switchingFriction: 0.3 },
      { name: "Unreal Engine", isOSS: false, featureParity: 0.95, switchingFriction: 0.6 },
      { name: "Custom In-House", isOSS: true, featureParity: 0.5, switchingFriction: 0.8 },
    ], { calibration });
    const totalShare = migration.reduce((sum, m) => sum + m.inflowSharePercent, 0);
    expect(totalShare).toBeCloseTo(100.0, 0);
    for (const m of migration) {
      expect(m.calibrationStatus).toMatch(/^calibrated \(fit from 13 observations/);
    }
  });

  it("uncalibrated and default-calibrated (identity params) outputs agree exactly", () => {
    const identity: ExecutiveCalibration = {
      params: { ...DEFAULT_EXECUTIVE_PARAMS },
      fitError: 0,
      perCaseResiduals: [],
      observationCount: 0,
      calibratedAt: CLOCK,
      status: "calibrated",
    };
    const plain = computeExecutiveARRRisk(totalARR, 0.65, 0.2);
    const calibrated = computeExecutiveARRRisk(totalARR, 0.65, 0.2, { calibration: identity });
    const { calibrationStatus: _plainStatus, ...plainNums } = plain;
    const { calibrationStatus: _calStatus, ...calibratedNums } = calibrated;
    expect(calibratedNums).toEqual(plainNums);
  });
});
