# Phase D — Executive-model calibration against observed outcomes

The executive models in `packages/engine/src/report-executive.ts` shipped with
hand-set parameters. This phase fits five of them against what observably
happened after four real vendor backlashes (Unity 2023, HashiCorp 2023,
Redis 2024, Docker Hub 2023). The observations live in
`bench/data-outcomes/observed-outcomes.json` — every value there carries a
public source URL, a retrieval date, and a confidence grade. The fitter is
`packages/engine/src/calibrate/executive-calibration.ts`; it reuses the
deterministic coordinate-descent scaffold in `calibrate/calibrate.ts` and
accepts only externally observed data, never engine output.

## What was fitted

| parameter                       | hand-set | fitted  | note              |
|---------------------------------|----------|---------|-------------------|
| hazardSlope                     | 4        | 1.0     | at min bound      |
| hazardMidpoint                  | 0.5      | 0.8     | at max bound      |
| utilityWeightIsOSS              | 1.5      | 2.18    |                   |
| utilityWeightFeatureParity      | 2.0      | 4.0     | at max bound      |
| utilityWeightSwitchingFriction  | 1.2      | 4.0     | at max bound      |

Not fitted (stay hand-set): the 0.45 exposure and 0.18 churn-rate
coefficients and the 1.65 / 0.35 / 0.4 / 0.65 scenario multipliers; the
hazard fit scores the `hazard * 0.18` branch of `baseLossRate` only.

## On what data

13 scored targets over 4 cases: 4 observed churn-share intervals (share of
affected users who left within ~1 year) and 9 migration-destination-share
intervals (share of movers choosing each destination). Outrage proxies
(0–1 index intervals) are *inputs* reconstructed from documented reaction
anchors (CEO departure, fork formation speed, walkback speed), never scored
as targets. Docker Hub contributes no migration targets: no quantitative
org-attrition source exists as of 2026-11-01, and we did not invent one.

## Fit error

Fitness = negative confidence-weighted squared error; predictions are
clamped into the observed interval before scoring; 1.0 unit = 10pp of share.

| parameter set      | RMSE (module units) | RMSE (percentage points) |
|--------------------|---------------------|--------------------------|
| hand-set defaults  | 0.602               | 6.0                      |
| fitted             | 0.248               | 2.5                      |

After fitting, 9 of 13 targets land inside their observed intervals. The
remaining misses are stated, not smoothed over: Redis KeyDB +7.1pp,
Redis Dragonfly −7.1pp, HashiCorp Pulumi −4.1pp, Unity Unreal +0.4pp,
Unity in-house −0.6pp.

## How to read the fitted numbers

- slope 1 / midpoint 0.8: observed churn shares (2–18%) are far below what
  the hand-set steep hazard implies at crisis outrage. The fit flattens the
  curve to the edge of its search box: `hazard * 0.18` ≈ 8–9% at outrage
  0.65–0.85, inside every observed churn interval.
- parity 4 / friction 4 / oss 2.2: destination choice is dominated by
  drop-in compatibility and switching cost. Open-source governance matters
  but is not sufficient — KeyDB is OSS *and* cheap to switch to, and still
  received almost no one.
- Kept-visible model–data conflict: the utility form has no term for fork
  momentum or network effects, so it overpredicts KeyDB and underpredicts
  Dragonfly. We chose to report the miss rather than widen the intervals
  until it disappeared.

## Honest limitations

- **N = 4.** Leave-one-out (refit on 3 cases, score the held-out one):
  Unity 1.92, Redis 0.86, HashiCorp 0.17, Docker 0.00 module units. One
  case can move the fit by up to ~19pp; the corpus is too small to hide
  that, and the LOO holdouts still share the corpus with the fit — this
  measures sensitivity, not out-of-sample accuracy.
- **Intervals, not measurements.** Several targets are structured estimates
  from qualitative evidence, flagged LOW in the data file. Wide intervals
  create zero-residual regions, so many parameter vectors are equally
  consistent; coordinate descent returns one deterministic member of that
  set, not a unique optimum.
- **No forecast-accuracy claim.** This calibrates consistency with four past
  cases. It does not predict the outcome of the next backlash, and no report
  should present the calibrated numbers as validated.
- Outrage proxies are reconstructed judgments anchored in documented events,
  not a measured quantity.

## How to re-run

```ts
import { applyCalibration, DEFAULT_EXECUTIVE_PARAMS, fitExecutiveParams } from "@murmur/engine";

const obs = JSON.parse(readFileSync("bench/data-outcomes/observed-outcomes.json", "utf8"));
const fit = fitExecutiveParams(obs, new Date().toISOString()); // clock injected; fit stays deterministic
const params = applyCalibration(DEFAULT_EXECUTIVE_PARAMS, fit);
// computeExecutiveARRRisk(arr, outrage, churn, { calibration: fit })
// computeCompetitorMigration(arr, accounts, competitors, { calibration: fit })
```

Tests: `npx vitest run --project unit tests/unit/executive-calibration.test.ts`
(offline; they assert fit determinism, finite fit error, LOO shape, and that
the two report functions *without* a calibration reproduce the pre-change
numbers exactly, reporting `calibrationStatus: "hand-set (uncalibrated)"`).
