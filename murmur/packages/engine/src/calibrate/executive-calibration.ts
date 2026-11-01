/**
 * Executive-model calibration against externally observed outcomes.
 *
 * DATA POLICY (mandatory, mirrors calibrate.ts): the observations fed into
 * this module MUST come from real, externally published events — vendor
 * announcements, foundation press releases, measured download/star counters,
 * dated press coverage — never from anything the engine itself generated.
 * The canonical data file is bench/data-outcomes/observed-outcomes.json at
 * the repository root; it is loaded by CALLERS (tests, tooling). This module
 * stays pure: no fs, no network, no data files, no Date.now().
 *
 * WHAT IS FITTED: the five hand-set parameters of the executive models in
 * report-executive.ts — the churn-hazard logistic (slope, midpoint) and the
 * three multinomial-logit utility weights (isOSS, featureParity,
 * switchingFriction). The remaining report-executive coefficients (the 0.45
 * exposure, 0.18 churn-rate, 1.65/0.35/0.4/0.65 scenario multipliers) are
 * NOT fitted here; they stay at their hand-set values.
 *
 * WHAT IS HONESTLY KNOWN (read before quoting a fit):
 * - N is tiny: 4 historical cases, 13 scored targets. Treat the output as
 *   "consistent with observations", not "validated by observations".
 * - Targets are intervals, not measurements: several encode structured
 *   estimates from qualitative evidence (flagged LOW confidence in the data
 *   file). Wide intervals make zero training error achievable for parts of
 *   the parameter box, so a small fitError is consistency, not accuracy.
 * - Coordinate descent is a local method; with flat interval regions there
 *   are many equally-consistent parameter vectors. This returns A
 *   deterministic optimum, not THE optimum.
 * - leaveOneOutErrors() refits on 3 cases and scores the held-out case, but
 *   with N=4 the holdout shares the corpus with the fit; it measures
 *   sensitivity, not out-of-sample forecast accuracy. Nothing here predicts
 *   future backlash outcomes.
 *
 * Method: fitness = negative weighted squared error. Each scored target is
 * compared to the model prediction after clamping the prediction into the
 * observed interval (point targets are zero-width intervals). Errors are
 * weighted by the observation's confidence (high=1, medium=0.5, low=0.25)
 * and normalized by SHARE_SCALE so one RMSE unit = 10 percentage points of
 * mispredicted share.
 */

import { calibrate, type ParamBound } from "./calibrate.js";

/** The five calibratable executive-model parameters. */
export type ExecutiveParams = {
  /** Logistic hazard slope: hazard = 1/(1+exp(-slope*(outrage-midpoint))). */
  hazardSlope: number;
  /** Logistic hazard midpoint (outrage index at hazard 0.5). */
  hazardMidpoint: number;
  /** Multinomial-logit utility weight for open-source governance. */
  utilityWeightIsOSS: number;
  /** Multinomial-logit utility weight for feature parity. */
  utilityWeightFeatureParity: number;
  /** Multinomial-logit utility weight (penalty) for switching friction. */
  utilityWeightSwitchingFriction: number;
}

/**
 * The exact hand-set values report-executive.ts shipped with, exported as
 * the calibration baseline (slope 4, midpoint 0.5; 1.5*isOSS + 2.0*parity
 * - 1.2*friction).
 */
export const DEFAULT_EXECUTIVE_PARAMS: Readonly<ExecutiveParams> = {
  hazardSlope: 4,
  hazardMidpoint: 0.5,
  utilityWeightIsOSS: 1.5,
  utilityWeightFeatureParity: 2.0,
  utilityWeightSwitchingFriction: 1.2,
};

/** Bounded search box for the coordinate descent. */
export const EXECUTIVE_PARAM_BOUNDS: Record<keyof ExecutiveParams, ParamBound> = {
  hazardSlope: { min: 1, max: 12 },
  hazardMidpoint: { min: 0.2, max: 0.8 },
  utilityWeightIsOSS: { min: 0, max: 4 },
  utilityWeightFeatureParity: { min: 0, max: 4 },
  utilityWeightSwitchingFriction: { min: 0, max: 4 },
};

/**
 * Coefficients that stay hand-set in report-executive.ts, restated here so
 * the fitness model and the production model share one meaning. Keep in
 * lockstep with report-executive.ts.
 */
export const HAZARD_EXPOSURE_COEF = 0.45;
export const HAZARD_CHURN_RATE_COEF = 0.18;

/** RMSE normalization: 1.0 unit = 10 percentage points of share error. */
export const SHARE_SCALE = 0.1;

export type Confidence = "high" | "medium" | "low";

/** One record from bench/data-outcomes/observed-outcomes.json. */
export interface ObservationRecord {
  caseId: string;
  metric: string;
  /** Point value, or [min,max] when interval is true. */
  value: number | [number, number];
  unit?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  confidence?: Confidence;
  notes?: string;
  interval?: boolean;
  /** Only records with usedInFit are consumed by the fit. */
  usedInFit?: boolean;
}

/** Per-case model inputs and destination attributes (not observations). */
export interface CaseMetadata {
  caseId: string;
  vendor?: string;
  announcementDate?: string;
  announcementUrl?: string;
  destinations?: Array<{
    name: string;
    isOSS: boolean;
    featureParity: number;
    switchingFriction: number;
  }>;
  notes?: string;
}

/** The shape of bench/data-outcomes/observed-outcomes.json. */
export interface ObservedOutcomes {
  retrievedAt?: string;
  caseMetadata: CaseMetadata[];
  cases: ObservationRecord[];
}

/** A scored target observation with its model prediction and residual. */
export interface CalibrationResidual {
  caseId: string;
  metric: string;
  /** Model prediction (share of movers, or churn share), before clamping. */
  predicted: number;
  /** Observed value: number, or [min,max] for interval targets. */
  observed: number | [number, number];
  /** predicted minus clamped prediction: signed error in share units. */
  residual: number;
  confidence: Confidence;
}

export interface ExecutiveCalibration {
  params: ExecutiveParams;
  /** Weighted RMSE over scored targets, in SHARE_SCALE units. */
  fitError: number;
  perCaseResiduals: CalibrationResidual[];
  /** Number of scored target observations (inputs are not counted). */
  observationCount: number;
  /** Injected clock value — the fit never reads Date.now() itself. */
  calibratedAt: string;
  status: "calibrated";
}

export interface LeaveOneOutError {
  caseId: string;
  /** Weighted RMSE of the held-out case's targets under the refit params. */
  rmse: number;
  targetsScored: number;
  note: string;
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  high: 1,
  medium: 0.5,
  low: 0.25,
};

const MIGRATION_METRIC_PREFIX = "migration-destination-share:";
const CHURN_METRIC = "affected-user-churn-share";
const OUTRAGE_METRIC = "outrage-proxy";

/** Case-insensitive share lookup; throws instead of returning NaN. */
function shareOf(shares: Map<string, number>, destinationName: string): number {
  const lower = destinationName.trim().toLowerCase();
  for (const [key, value] of shares) {
    if (key.trim().toLowerCase() === lower) return value;
  }
  throw new Error(`executive-calibration: no destination named "${destinationName}"`);
}

interface Interval {
  lo: number;
  hi: number;
}

function toInterval(value: number | [number, number]): Interval {
  if (Array.isArray(value)) {
    const lo = Math.min(value[0], value[1]);
    const hi = Math.max(value[0], value[1]);
    return { lo, hi };
  }
  return { lo: value, hi: value };
}

function clampInto(v: number, iv: Interval): number {
  return Math.min(iv.hi, Math.max(iv.lo, v));
}

/** Logistic hazard at an outrage level under the given slope/midpoint. */
export function hazardAt(outrage: number, params: ExecutiveParams): number {
  return 1 / (1 + Math.exp(-params.hazardSlope * (outrage - params.hazardMidpoint)));
}

/**
 * Predicted churn share of affected users at a given outrage level under
 * the hazard branch of report-executive's baseLossRate:
 * baseLossRate = max(churnedFraction, hazard * HAZARD_CHURN_RATE_COEF).
 * The fit scores the hazard branch only; feeding the observed churn back
 * through max() would let the model match any target trivially.
 */
export function predictedChurnShare(outrage: number, params: ExecutiveParams): number {
  return hazardAt(outrage, params) * HAZARD_CHURN_RATE_COEF;
}

/**
 * Multinomial-logit destination shares, temperature 1, exactly the softmax
 * used by computeCompetitorMigration: U_i = wOss*isOSS + wParity*parity
 * - wFriction*friction, normalized after max-subtraction for stability.
 */
export function destinationShares(
  destinations: NonNullable<CaseMetadata["destinations"]>,
  params: ExecutiveParams,
): Map<string, number> {
  const utils = destinations.map((d) => ({
    name: d.name,
    u:
      params.utilityWeightIsOSS * (d.isOSS ? 1 : 0) +
      params.utilityWeightFeatureParity * d.featureParity -
      params.utilityWeightSwitchingFriction * d.switchingFriction,
  }));
  const maxU = Math.max(...utils.map((x) => x.u));
  const expSum = utils.reduce((acc, x) => acc + Math.exp(x.u - maxU), 0);
  return new Map(utils.map((x) => [x.name, Math.exp(x.u - maxU) / expSum]));
}

interface TargetRecord {
  record: ObservationRecord;
  caseId: string;
  metric: string;
  interval: Interval;
  weight: number;
}

interface ParsedCorpus {
  targets: TargetRecord[];
  /** Midpoint of each case's outrage-proxy interval (hazard input). */
  outrageByCase: Map<string, number>;
  destinationsByCase: Map<string, NonNullable<CaseMetadata["destinations"]>>;
}

function parseCorpus(observations: ObservedOutcomes): ParsedCorpus {
  const destinationsByCase = new Map<string, NonNullable<CaseMetadata["destinations"]>>();
  for (const meta of observations.caseMetadata ?? []) {
    if (meta.destinations && meta.destinations.length > 0) {
      destinationsByCase.set(meta.caseId, meta.destinations);
    }
  }

  const outrageByCase = new Map<string, number>();
  const targets: TargetRecord[] = [];

  for (const record of observations.cases ?? []) {
    if (record.usedInFit !== true) continue;
    const confidence: Confidence = record.confidence ?? "medium";
    const interval = toInterval(record.value);

    if (record.metric === OUTRAGE_METRIC) {
      // Input to the hazard model, never scored.
      const mid = (interval.lo + interval.hi) / 2;
      if (!Number.isFinite(mid)) {
        throw new Error(`executive-calibration: non-finite outrage proxy for ${record.caseId}`);
      }
      outrageByCase.set(record.caseId, mid);
      continue;
    }

    if (record.metric === CHURN_METRIC) {
      targets.push({ record, caseId: record.caseId, metric: CHURN_METRIC, interval, weight: CONFIDENCE_WEIGHT[confidence] });
      continue;
    }

    if (record.metric.startsWith(MIGRATION_METRIC_PREFIX)) {
      const destName = record.metric.slice(MIGRATION_METRIC_PREFIX.length).trim().toLowerCase();
      const dests = destinationsByCase.get(record.caseId);
      if (!dests) {
        throw new Error(
          `executive-calibration: migration target for ${record.caseId} but caseMetadata has no destinations`,
        );
      }
      const known = dests.some((d) => d.name.trim().toLowerCase() === destName);
      if (!known) {
        throw new Error(
          `executive-calibration: migration target "${record.metric}" does not match any destination in caseMetadata for ${record.caseId}`,
        );
      }
      targets.push({ record, caseId: record.caseId, metric: record.metric, interval, weight: CONFIDENCE_WEIGHT[confidence] });
      continue;
    }

    throw new Error(
      `executive-calibration: record ${record.caseId}/${record.metric} is marked usedInFit but its metric is neither "${OUTRAGE_METRIC}", "${CHURN_METRIC}" nor a "${MIGRATION_METRIC_PREFIX}*" target`,
    );
  }

  for (const t of targets) {
    if (t.metric === CHURN_METRIC && !outrageByCase.has(t.caseId)) {
      throw new Error(
        `executive-calibration: churn target for ${t.caseId} has no usedInFit "${OUTRAGE_METRIC}" record to supply the hazard input`,
      );
    }
  }

  return { targets, outrageByCase, destinationsByCase };
}

/** Weighted squared error of all scored targets under the given params. */
/** Require a parsed corpus case to exist — targets reference cases by id. */
function requireCase<T>(m: Map<string, T>, caseId: string, what: string): T {
  const v = m.get(caseId);
  if (v === undefined)
    throw new Error(`executive-calibration: missing ${what} case '${caseId}'`);
  return v;
}

function weightedSquaredError(corpus: ParsedCorpus, params: ExecutiveParams): number {
  let sumWxE = 0;
  let sumW = 0;
  for (const t of corpus.targets) {
    const predicted =
      t.metric === CHURN_METRIC
        ? predictedChurnShare(requireCase(corpus.outrageByCase, t.caseId, "outrage"), params)
        : shareOf(
            destinationShares(requireCase(corpus.destinationsByCase, t.caseId, "destination"), params),
            t.metric.slice(MIGRATION_METRIC_PREFIX.length),
          );
    const clamped = clampInto(predicted, t.interval);
    const residual = (predicted - clamped) / SHARE_SCALE;
    sumWxE += t.weight * residual * residual;
    sumW += t.weight;
  }
  if (sumW <= 0) {
    throw new Error("executive-calibration: no scored target observations (check usedInFit flags)");
  }
  return sumWxE / sumW;
}

function residualsFor(corpus: ParsedCorpus, params: ExecutiveParams): CalibrationResidual[] {
  return corpus.targets.map((t) => {
    const predicted =
      t.metric === CHURN_METRIC
        ? predictedChurnShare(requireCase(corpus.outrageByCase, t.caseId, "outrage"), params)
        : shareOf(
            destinationShares(requireCase(corpus.destinationsByCase, t.caseId, "destination"), params),
            t.metric.slice(MIGRATION_METRIC_PREFIX.length),
          );
    const clamped = clampInto(predicted, t.interval);
    const confidence: Confidence = t.record.confidence ?? "medium";
    return {
      caseId: t.caseId,
      metric: t.metric,
      predicted,
      observed: t.record.value,
      residual: predicted - clamped,
      confidence,
    };
  });
}

function weightedRmse(residuals: CalibrationResidual[]): number {
  let sumWxE = 0;
  let sumW = 0;
  for (const r of residuals) {
    const w = CONFIDENCE_WEIGHT[r.confidence];
    sumWxE += w * (r.residual / SHARE_SCALE) ** 2;
    sumW += w;
  }
  if (sumW <= 0) return 0;
  return Math.sqrt(sumWxE / sumW);
}

const FIT_ITERATIONS = 40;

/**
 * Fit the five executive parameters against observed outcomes via the
 * deterministic coordinate-descent scaffold. Pure: identical inputs
 * (including the injected clock) always return identical results.
 *
 * @param observations the parsed bench/data-outcomes/observed-outcomes.json
 * @param now injected clock (ISO string or epoch millis); never Date.now()
 */
export function fitExecutiveParams(
  observations: ObservedOutcomes,
  now: string | number | Date,
): ExecutiveCalibration {
  const corpus = parseCorpus(observations);
  const result = calibrate<ExecutiveParams>(
    { ...DEFAULT_EXECUTIVE_PARAMS },
    (p) => -weightedSquaredError(corpus, p),
    EXECUTIVE_PARAM_BOUNDS,
    FIT_ITERATIONS,
  );
  const residuals = residualsFor(corpus, result.params);
  const calibratedAt =
    typeof now === "string" ? now : new Date(now).toISOString();
  return {
    params: result.params,
    fitError: weightedRmse(residuals),
    perCaseResiduals: residuals,
    observationCount: residuals.length,
    calibratedAt,
    status: "calibrated",
  };
}

/**
 * Per-case holdout error: refit on all cases EXCEPT the held-out case, then
 * score the held-out case's targets under the refit params. HONESTY: with
 * N=4 the holdout is not independent of the corpus — this measures how much
 * each case pulls the fit, not out-of-sample forecast accuracy.
 */
export function leaveOneOutErrors(
  observations: ObservedOutcomes,
  now: string | number | Date,
): LeaveOneOutError[] {
  const corpus = parseCorpus(observations);
  const caseIds = [...new Set(corpus.targets.map((t) => t.caseId))];
  return caseIds.map((caseId) => {
    const heldOut: ObservedOutcomes = {
      ...observations,
      cases: (observations.cases ?? []).filter(
        (r) => !(r.usedInFit === true && r.caseId === caseId),
      ),
    };
    const heldTargets = corpus.targets.filter((t) => t.caseId === caseId);
    if (heldTargets.length === 0) {
      return {
        caseId,
        rmse: 0,
        targetsScored: 0,
        note: "no scored targets for this case; excluded",
      };
    }
    const refit = fitExecutiveParams(heldOut, now);
    const scored = residualsFor(corpus, refit.params).filter((r) => r.caseId === caseId);
    return {
      caseId,
      rmse: weightedRmse(scored),
      targetsScored: scored.length,
      note: "refit on the other cases; holdout shares the corpus with the fit (N is tiny)",
    };
  });
}

/**
 * Overlay a calibration onto a parameter set: the calibration's fitted
 * values win; anything the calibration does not provide keeps the current
 * value. Pure.
 */
export function applyCalibration(
  currentParams: ExecutiveParams,
  calibration: Pick<ExecutiveCalibration, "params">,
): ExecutiveParams {
  return { ...currentParams, ...calibration.params };
}
