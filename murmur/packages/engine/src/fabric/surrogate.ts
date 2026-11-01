/**
 * Persona Fabric — surrogate models.
 *
 * A surrogate is a tiny trait-space model trained on labeled examples
 * (oppose/support per claim, objection ids per claim, migration choice) and
 * applied to fabricated populations with ZERO LLM calls at evaluation time.
 * It compresses labeled opinions; it is not a measurement of people.
 *
 * Heads:
 *   - binary logistic regression per claim  → stance (support probability),
 *     plus one pooled head over all support labels for claim-less predicts.
 *   - multinomial softmax per claim         → objection distribution.
 *   - one multinomial softmax (global)      → migration choice among K options.
 *
 * Determinism contract: full-batch gradient descent from zero weights, fixed
 * iteration count, fixed learning rate, L2 regularization, classes sorted at
 * fit time, holdout split keyed by a stable hash of (seed, example index).
 * Same examples + same options ⇒ identical model JSON.
 */
import { resolvePersonaIndex, round6, type FabricPopulation } from "./sample.js";
import {
  MAX_FABRIC_POPULATION,
  TRAIT_COUNT,
  TRAIT_KEYS,
} from "./traits.js";
import { hashString } from "../util/rng.js";

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

/**
 * One labeled example. `traits` is either a TRAIT_KEYS-ordered array or a
 * record keyed by trait name; every label kind is optional but an example
 * with no label at all is rejected by fit().
 */
export interface FabricExample {
  traits: number[] | Record<string, number>;
  /** Claim the stance/objection labels are about. */
  claimId?: string;
  /** 1 = support the claim, 0 = oppose. */
  support?: number;
  /** Which objection this example raised (multinomial class id). */
  objectionId?: string;
  /** Which migration option this example chose (multinomial class id). */
  choiceId?: string;
}

// ---------------------------------------------------------------------------
// Model shape (plain JSON — this is the persisted form)
// ---------------------------------------------------------------------------

export interface BinaryHeadJson {
  /** Weight per trait, TRAIT_KEYS order. */
  weights: number[];
  bias: number;
}

export interface SoftmaxHeadJson {
  /** Class ids, sorted ascending at fit time. */
  classes: string[];
  /** weights[c][k] — class c, trait k. */
  weights: number[][];
  biases: number[];
}

export interface FabricMetrics {
  holdoutAccuracy: number;
  macroF1: number;
  logLoss: number;
  labeledCount: number;
  /** Same as labeledCount: every label is a real example, nothing is resampled. */
  effectiveSampleSize: number;
  holdoutN: number;
}

export interface SurrogateModel {
  format: "murmur-fabric-surrogate";
  version: 1;
  traitKeys: string[];
  /** Stance head trained on all support labels (predict without a claim). */
  pooledStance: BinaryHeadJson | null;
  /** Per-claim stance + objection heads, keyed by claimId. */
  claims: Record<string, { stance: BinaryHeadJson; objections: SoftmaxHeadJson | null }>;
  /** Global migration-choice head. */
  migration: SoftmaxHeadJson | null;
  metrics: FabricMetrics;
  training: {
    iterations: number;
    learningRate: number;
    l2: number;
    seed: string;
    examples: number;
    holdoutFraction: number;
  };
}

export interface FitOptions {
  seed: string;
  /** Holdout fraction (default 0.2) — split by stable (seed, index) hash. */
  holdoutFraction?: number;
  iterations?: number;
  learningRate?: number;
  l2?: number;
}

export interface FitResult {
  model: SurrogateModel;
  metrics: FabricMetrics;
}

// Fixed hyperparameters — part of the determinism contract, not knobs.
const DEFAULT_ITERATIONS = 400;
const DEFAULT_LEARNING_RATE = 0.5;
const DEFAULT_L2 = 1e-4;
const DEFAULT_HOLDOUT = 0.2;
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// fit
// ---------------------------------------------------------------------------

/** Fit a surrogate model. Deterministic end to end; no randomness but the seed. */
export function fit(
  labeledExamples: readonly FabricExample[],
  opts: FitOptions,
): FitResult {
  if (typeof opts.seed !== "string" || opts.seed.length === 0) {
    throw new Error("fit() needs a non-empty seed");
  }
  if (labeledExamples.length === 0) {
    throw new Error("fit() needs at least one labeled example");
  }
  if (labeledExamples.length > MAX_FABRIC_POPULATION) {
    throw new Error("too many labeled examples");
  }
  const holdoutFraction = opts.holdoutFraction ?? DEFAULT_HOLDOUT;
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const learningRate = opts.learningRate ?? DEFAULT_LEARNING_RATE;
  const l2 = opts.l2 ?? DEFAULT_L2;

  // Normalize traits once; reject anything that is not 10 values in [0,1].
  const vectors: Float64Array[] = labeledExamples.map((ex, i) =>
    exampleVector(ex, i),
  );

  // Deterministic split: stable hash of (seed, index) — same example order
  // and seed always produce the same train/holdout partition.
  const cutoff = Math.round(holdoutFraction * 10000);
  const isHoldout = (i: number): boolean =>
    hashString(`${opts.seed}:holdout:${i}`) % 10000 < cutoff;

  const labeled: number[] = [];
  for (let i = 0; i < labeledExamples.length; i++) {
    const ex = labeledExamples[i];
    const hasLabel =
      ex.support !== undefined ||
      ex.objectionId !== undefined ||
      ex.choiceId !== undefined;
    if (hasLabel) labeled.push(i);
  }
  if (labeled.length === 0) {
    throw new Error("fit() found no labeled examples (need support, objectionId or choiceId)");
  }

  // ---- stance heads (binary logistic) ------------------------------------
  const supportPool: { i: number; y: number }[] = [];
  const byClaimSupport = new Map<string, { i: number; y: number }[]>();
  for (const i of labeled) {
    const ex = labeledExamples[i];
    if (ex.support === undefined) continue;
    const y = exampleLabel(ex.support, i);
    supportPool.push({ i, y });
    if (ex.claimId) {
      let arr = byClaimSupport.get(ex.claimId);
      if (!arr) {
        arr = [];
        byClaimSupport.set(ex.claimId, arr);
      }
      arr.push({ i, y });
    }
  }
  const trainOf = <T extends { i: number }>(rows: readonly T[]): T[] =>
    rows.filter((r) => !isHoldout(r.i));
  const holdoutOf = <T extends { i: number }>(rows: readonly T[]): T[] =>
    rows.filter((r) => isHoldout(r.i));

  const pooledTrain = trainOf(supportPool);
  const pooledStance = pooledTrain.length
    ? fitBinary(
        vectors,
        pooledTrain.map((r) => r.i),
        pooledTrain.map((r) => r.y),
        iterations,
        learningRate,
        l2,
      )
    : null;

  const claims: SurrogateModel["claims"] = {};
  const claimIds = [...byClaimSupport.keys()].sort();
  for (const claimId of claimIds) {
    const rows = byClaimSupport.get(claimId);
    if (!rows) continue; // unreachable — key came from the map itself
    const train = trainOf(rows);
    if (train.length === 0) continue; // claim seen only in holdout — no head
    const stance = fitBinary(
      vectors,
      train.map((r) => r.i),
      train.map((r) => r.y),
      iterations,
      learningRate,
      l2,
    );
    claims[claimId] = { stance, objections: null };
  }

  // ---- objection heads (multinomial softmax, per claim) -------------------
  const byClaimObjection = new Map<string, { i: number; c: string }[]>();
  for (const i of labeled) {
    const ex = labeledExamples[i];
    if (ex.objectionId === undefined || !ex.claimId) continue;
    let arr = byClaimObjection.get(ex.claimId);
    if (!arr) {
      arr = [];
      byClaimObjection.set(ex.claimId, arr);
    }
    arr.push({ i, c: ex.objectionId });
  }
  for (const [claimId, rows] of byClaimObjection) {
    const train = trainOf(rows);
    if (train.length === 0) continue;
    const classes = [...new Set(rows.map((r) => r.c))].sort();
    const head = fitSoftmax(
      vectors,
      train.map((r) => r.i),
      train.map((r) => classes.indexOf(r.c)),
      classes,
      iterations,
      learningRate,
      l2,
    );
    const entry = claims[claimId];
    if (entry) entry.objections = head;
    else claims[claimId] = { stance: zeroBinary(), objections: head };
  }

  // ---- migration head (multinomial softmax, global) ------------------------
  let migration: SoftmaxHeadJson | null = null;
  const migrationRows: { i: number; c: string }[] = [];
  for (const i of labeled) {
    const ex = labeledExamples[i];
    if (ex.choiceId !== undefined) migrationRows.push({ i, c: ex.choiceId });
  }
  const migrationTrain = trainOf(migrationRows);
  if (migrationTrain.length > 0) {
    const classes = [...new Set(migrationRows.map((r) => r.c))].sort();
    migration = fitSoftmax(
      vectors,
      migrationTrain.map((r) => r.i),
      migrationTrain.map((r) => classes.indexOf(r.c)),
      classes,
      iterations,
      learningRate,
      l2,
    );
  }

  // ---- metrics on the pooled stance task ----------------------------------
  const metrics = stanceMetrics(
    vectors,
    holdoutOf(supportPool),
    pooledStance,
    labeled.length,
  );

  const model: SurrogateModel = {
    format: "murmur-fabric-surrogate",
    version: 1,
    traitKeys: [...TRAIT_KEYS],
    pooledStance,
    claims,
    migration,
    metrics,
    training: {
      iterations,
      learningRate,
      l2,
      seed: opts.seed,
      examples: labeledExamples.length,
      holdoutFraction,
    },
  };
  return { model, metrics };
}

/** Traits of one example as a validated TRAIT_KEYS-ordered vector. */
function exampleVector(ex: FabricExample, at: number): Float64Array {
  const v = new Float64Array(TRAIT_COUNT);
  if (Array.isArray(ex.traits)) {
    if (ex.traits.length !== TRAIT_COUNT) {
      throw new Error(
        `example ${at}: traits array must have ${TRAIT_COUNT} values in TRAIT_KEYS order (got ${ex.traits.length})`,
      );
    }
    for (let k = 0; k < TRAIT_COUNT; k++) {
      const t = ex.traits[k];
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
        throw new Error(`example ${at}: trait '${TRAIT_KEYS[k]}' must be a number in [0,1]`);
      }
      v[k] = t;
    }
    return v;
  }
  if (ex.traits && typeof ex.traits === "object") {
    for (let k = 0; k < TRAIT_COUNT; k++) {
      const t = (ex.traits as Record<string, number>)[TRAIT_KEYS[k]];
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
        throw new Error(
          `example ${at}: trait '${TRAIT_KEYS[k]}' must be a number in [0,1] (missing or invalid)`,
        );
      }
      v[k] = t;
    }
    return v;
  }
  throw new Error(`example ${at}: traits must be an array or a record keyed by trait name`);
}

function exampleLabel(support: number, at: number): number {
  if (support !== 0 && support !== 1) {
    throw new Error(
      `example ${at}: support must be 0 (oppose) or 1 (support), got ${String(support)}`,
    );
  }
  return support;
}

function zeroBinary(): BinaryHeadJson {
  return { weights: new Array<number>(TRAIT_COUNT).fill(0), bias: 0 };
}

/**
 * Full-batch gradient descent for logistic regression from zero weights.
 * Returns plain JSON arrays (weights, bias) — the persisted head shape.
 */
function fitBinary(
  vectors: readonly Float64Array[],
  trainIdx: readonly number[],
  labels: readonly number[],
  iterations: number,
  lr: number,
  l2: number,
): BinaryHeadJson {
  const n = trainIdx.length;
  const w = new Float64Array(TRAIT_COUNT);
  let b = 0;
  const gw = new Float64Array(TRAIT_COUNT);
  for (let it = 0; it < iterations; it++) {
    gw.fill(0);
    let gb = 0;
    for (let j = 0; j < n; j++) {
      const x = vectors[trainIdx[j]];
      let z = b;
      for (let k = 0; k < TRAIT_COUNT; k++) z += w[k] * x[k];
      const p = sigmoid(z);
      const err = p - labels[j];
      for (let k = 0; k < TRAIT_COUNT; k++) gw[k] += err * x[k];
      gb += err;
    }
    for (let k = 0; k < TRAIT_COUNT; k++) {
      w[k] -= lr * (gw[k] / n + l2 * w[k]);
    }
    b -= lr * (gb / n);
  }
  return { weights: Array.from(w), bias: b };
}

/**
 * Full-batch gradient descent for multinomial logistic regression (softmax)
 * from zero weights. Classes are 0..K-1 in sorted-class order.
 */
function fitSoftmax(
  vectors: readonly Float64Array[],
  trainIdx: readonly number[],
  classIdx: readonly number[],
  classes: readonly string[],
  iterations: number,
  lr: number,
  l2: number,
): SoftmaxHeadJson {
  const kClasses = classes.length;
  const n = trainIdx.length;
  const w: Float64Array[] = [];
  const b = new Float64Array(kClasses);
  const gw: Float64Array[] = [];
  const gb = new Float64Array(kClasses);
  const scores = new Float64Array(kClasses);
  for (let c = 0; c < kClasses; c++) {
    w.push(new Float64Array(TRAIT_COUNT));
    gw.push(new Float64Array(TRAIT_COUNT));
  }
  for (let it = 0; it < iterations; it++) {
    for (let c = 0; c < kClasses; c++) {
      gw[c].fill(0);
      gb[c] = 0;
    }
    for (let j = 0; j < n; j++) {
      const x = vectors[trainIdx[j]];
      const y = classIdx[j];
      let max = -Infinity;
      for (let c = 0; c < kClasses; c++) {
        let z = b[c];
        const wc = w[c];
        for (let k = 0; k < TRAIT_COUNT; k++) z += wc[k] * x[k];
        scores[c] = z;
        if (z > max) max = z;
      }
      let sum = 0;
      for (let c = 0; c < kClasses; c++) {
        scores[c] = Math.exp(scores[c] - max);
        sum += scores[c];
      }
      for (let c = 0; c < kClasses; c++) {
        const p = scores[c] / sum;
        const err = p - (c === y ? 1 : 0);
        if (err === 0) continue;
        const gwc = gw[c];
        const x = vectors[trainIdx[j]];
        for (let k = 0; k < TRAIT_COUNT; k++) gwc[k] += err * x[k];
        gb[c] += err;
      }
    }
    for (let c = 0; c < kClasses; c++) {
      const wc = w[c];
      const gwc = gw[c];
      for (let k = 0; k < TRAIT_COUNT; k++) {
        wc[k] -= lr * (gwc[k] / n + l2 * wc[k]);
      }
      b[c] -= lr * (gb[c] / n);
    }
  }
  return {
    classes: [...classes],
    weights: w.map((wc) => Array.from(wc)),
    biases: Array.from(b),
  };
}

// ---------------------------------------------------------------------------
// predict
// ---------------------------------------------------------------------------

export interface FabricPrediction {
  /** Signed stance in [-1, 1]; +1 support, -1 oppose. */
  stance: number;
  /** |stance| in [0, 1] — how far the persona is from neutral. */
  intensity: number;
  topObjectionId: string | null;
  migrationChoiceId: string | null;
  /** "uncalibrated" when no fitted head covers this (persona, claim) pair. */
  calibration: "calibrated" | "uncalibrated";
}

/**
 * Predict one persona's reaction from trait values. Deterministic pure
 * function of (model, traits, claimId). Without a claimId the pooled stance
 * head is used; a claim WITHOUT its own fitted head yields calibration
 * "uncalibrated" (never a pooled fallback — the caller must label the output
 * UNCALIBRATED, see METHODOLOGY.md).
 */
export function predict(
  model: SurrogateModel | null,
  traits: number[] | Record<string, number>,
  claimId?: string,
): FabricPrediction {
  const v = predictVector(traits);
  const head = model
    ? claimId
      ? model.claims[claimId]?.stance ?? null
      : model.pooledStance
    : null;
  const calibrated = !!head;
  let stance = 0;
  if (head) {
    let z = head.bias;
    for (let k = 0; k < TRAIT_COUNT; k++) z += head.weights[k] * v[k];
    stance = 2 * sigmoid(z) - 1;
  }

  let topObjectionId: string | null = null;
  const objections = claimId && model ? model.claims[claimId]?.objections : null;
  if (objections) topObjectionId = argmaxSoftmax(objections, v);

  let migrationChoiceId: string | null = null;
  if (model?.migration) migrationChoiceId = argmaxSoftmax(model.migration, v);

  return {
    stance: round6(stance),
    intensity: round6(Math.abs(stance)),
    topObjectionId,
    migrationChoiceId,
    calibration: calibrated ? "calibrated" : "uncalibrated",
  };
}

/** Predict for a whole population row (index) — same semantics as predict(). */
export function predictPersona(
  model: SurrogateModel | null,
  population: FabricPopulation,
  index: number,
  claimId?: string,
): FabricPrediction {
  resolvePersonaIndex(population, index);
  const v: number[] = new Array<number>(TRAIT_COUNT);
  for (let k = 0; k < TRAIT_COUNT; k++) v[k] = population.traits[k][index];
  return predict(model, v, claimId);
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Serialize a model to plain JSON for storage (no functions, no typed arrays). */
export function modelToJson(model: SurrogateModel): Record<string, unknown> {
  return JSON.parse(JSON.stringify(model)) as Record<string, unknown>;
}

/**
 * Rebuild a model from its JSON form. Validates the envelope and head shapes;
 * throws on anything that is not a model this module produced.
 */
export function modelFromJson(json: unknown): SurrogateModel {
  if (!json || typeof json !== "object") {
    throw new Error("surrogate model JSON must be an object");
  }
  const m = json as Record<string, unknown>;
  if (m.format !== "murmur-fabric-surrogate" || m.version !== 1) {
    throw new Error("not a murmur-fabric-surrogate model (format/version mismatch)");
  }
  if (
    !Array.isArray(m.traitKeys) ||
    (m.traitKeys as string[]).join(",") !== TRAIT_KEYS.join(",")
  ) {
    throw new Error("surrogate model traitKeys do not match this engine's TRAIT_KEYS");
  }
  const claims: SurrogateModel["claims"] = {};
  const rawClaims = (m.claims ?? {}) as Record<string, unknown>;
  for (const [claimId, head] of Object.entries(rawClaims)) {
    const h = head as { stance?: unknown; objections?: unknown };
    claims[claimId] = {
      stance: readBinary(h.stance, `claims.${claimId}.stance`),
      objections: h.objections ? readSoftmax(h.objections, `claims.${claimId}.objections`) : null,
    };
  }
  const out: SurrogateModel = {
    format: "murmur-fabric-surrogate",
    version: 1,
    traitKeys: [...TRAIT_KEYS],
    pooledStance: m.pooledStance ? readBinary(m.pooledStance, "pooledStance") : null,
    claims,
    migration: m.migration ? readSoftmax(m.migration, "migration") : null,
    metrics: m.metrics as FabricMetrics,
    training: m.training as SurrogateModel["training"],
  };
  if (!out.metrics || typeof out.metrics.holdoutAccuracy !== "number") {
    throw new Error("surrogate model is missing metrics");
  }
  if (!out.training || typeof out.training.iterations !== "number") {
    throw new Error("surrogate model is missing training metadata");
  }
  return out;
}

function readBinary(v: unknown, at: string): BinaryHeadJson {
  const h = v as { weights?: unknown; bias?: unknown };
  if (!h || !Array.isArray(h.weights) || h.weights.length !== TRAIT_COUNT) {
    throw new Error(`${at}: binary head must carry ${TRAIT_COUNT} weights`);
  }
  return { weights: (h.weights as number[]).map(Number), bias: Number(h.bias) };
}

function readSoftmax(v: unknown, at: string): SoftmaxHeadJson {
  const h = v as { classes?: unknown; weights?: unknown; biases?: unknown };
  if (!h || !Array.isArray(h.classes) || !Array.isArray(h.weights) || !Array.isArray(h.biases)) {
    throw new Error(`${at}: softmax head must carry classes, weights, biases`);
  }
  const k = h.classes.length;
  if (h.weights.length !== k || h.biases.length !== k) {
    throw new Error(`${at}: softmax head arrays disagree on class count`);
  }
  return {
    classes: (h.classes as string[]).map(String),
    weights: (h.weights as number[][]).map((row) => row.map(Number)),
    biases: (h.biases as number[]).map(Number),
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function predictVector(traits: number[] | Record<string, number>): Float64Array {
  const v = new Float64Array(TRAIT_COUNT);
  if (Array.isArray(traits)) {
    if (traits.length !== TRAIT_COUNT) {
      throw new Error(`traits array must have ${TRAIT_COUNT} values in TRAIT_KEYS order`);
    }
    for (let k = 0; k < TRAIT_COUNT; k++) v[k] = traits[k];
    return v;
  }
  for (let k = 0; k < TRAIT_COUNT; k++) {
    const t = (traits as Record<string, number>)[TRAIT_KEYS[k]];
    if (typeof t !== "number") {
      throw new Error(`traits record is missing '${TRAIT_KEYS[k]}'`);
    }
    v[k] = t;
  }
  return v;
}

function argmaxSoftmax(head: SoftmaxHeadJson, v: Float64Array): string {
  let best = 0;
  let bestScore = -Infinity;
  for (let c = 0; c < head.classes.length; c++) {
    const row = head.weights[c];
    let z = head.biases[c];
    for (let k = 0; k < TRAIT_COUNT; k++) z += row[k] * v[k];
    if (z > bestScore) {
      bestScore = z;
      best = c;
    }
  }
  return head.classes[best];
}

/**
 * Binary classification metrics on the holdout slice of the pooled stance
 * task. holdoutN counts support-labeled holdout examples; when it is 0 the
 * quality figures are 0 (no evidence — the honesty block still prints).
 */
function stanceMetrics(
  vectors: readonly Float64Array[],
  holdout: readonly { i: number; y: number }[],
  head: BinaryHeadJson | null,
  labeledCount: number,
): FabricMetrics {
  if (!head || holdout.length === 0) {
    return {
      holdoutAccuracy: 0,
      macroF1: 0,
      logLoss: 0,
      labeledCount,
      effectiveSampleSize: labeledCount,
      holdoutN: holdout.length,
    };
  }
  let correct = 0;
  let loss = 0;
  // Confusion counts for macro-F1 over the two classes.
  const tp = [0, 0];
  const fp = [0, 0];
  const fn = [0, 0];
  for (const { i, y } of holdout) {
    const x = vectors[i];
    let z = head.bias;
    for (let k = 0; k < TRAIT_COUNT; k++) z += head.weights[k] * x[k];
    const p = sigmoid(z);
    const yhat = p >= 0.5 ? 1 : 0;
    if (yhat === y) correct++;
    loss -= Math.log(Math.max(p, EPS)) * y + Math.log(Math.max(1 - p, EPS)) * (1 - y);
    if (yhat === 1 && y === 1) tp[1]++;
    if (yhat === 1 && y === 0) fp[1]++;
    if (yhat === 0 && y === 1) fn[1]++;
    if (yhat === 0 && y === 0) tp[0]++;
    if (yhat === 0 && y === 1) fp[0]++;
    if (yhat === 1 && y === 0) fn[0]++;
  }
  let f1Sum = 0;
  for (const c of [0, 1]) {
    const precision = tp[c] + fp[c] > 0 ? tp[c] / (tp[c] + fp[c]) : 0;
    const recall = tp[c] + fn[c] > 0 ? tp[c] / (tp[c] + fn[c]) : 0;
    f1Sum +=
      precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  }
  return {
    holdoutAccuracy: round6(correct / holdout.length),
    macroF1: round6(f1Sum / 2),
    logLoss: round6(loss / holdout.length),
    labeledCount,
    effectiveSampleSize: labeledCount,
    holdoutN: holdout.length,
  };
}
