# Persona Fabric (Phase B)

Deterministic surrogate populations for murmur-mcp. Up to 1,000,000 individually
queryable personas, **zero LLM calls at evaluation time**, byte-identical replay
from a seed. Code lives in `murmur/packages/engine/src/fabric/`; the MCP surface
rides the existing `personas` and `sim` tools (TOOL_COUNT stays 11).

## What it is

Persona Fabric fits a small trait-space model to *labeled examples you supply*
(support/oppose per claim, objection ids, migration choices) and applies it to a
fabricated population. It answers "what would this compressed opinion model
say?" at population scale — instantly, offline, replayably.

The pipeline: `fabricate()` mints a population → `fit()` trains a surrogate on
labeled examples → `massEvaluate()` aggregates over everyone → `lazyPersona()`
interviews one persona on demand. The population and the model are separate
artifacts; a model generalizes over trait space and works on any population.

## Design

- **traits.ts** — 10 numeric traits in `[0,1]` (`TRAIT_KEYS`, fixed order) and 8
  archetypes (`FABRIC_ARCHETYPES`) with per-trait prior means and sds. The
  archetypes are numeric priors, distinct from the LLM-drafting archetypes in
  `engine/personas.ts`.
- **sample.ts** — `fabricate({count, archetypeWeights?, seed})` → typed arrays
  only: one `Float64Array` per trait (column-major), `Uint8Array` archetype ids,
  `Uint32Array` per-persona seeds. No per-persona objects at rest. Persona i is
  seeded from `murmur-fabric:<seed>:<i>`, so persona #i is byte-stable as the
  population grows; archetype assignment walks one master stream in order.
  Personas are addressable as `i` or `'#i'`.
- **surrogate.ts** — binary logistic regression (stance: oppose vs support) plus
  multinomial softmax heads (objections per claim; one global migration choice
  among K options). Full-batch gradient descent from zero weights, fixed
  iterations (400), fixed learning rate (0.5), L2 (1e-4), classes sorted at fit
  time. The 80/20 holdout split is a stable hash of `(seed, example index)` —
  same data + seed ⇒ identical model JSON. Models serialize to plain JSON
  (`modelToJson` / `modelFromJson`).
- **evaluate.ts** — `massEvaluate(model, population, claims)` runs column-major
  typed-array passes with hoisted scratch buffers; nothing is allocated per
  persona. Measured on a laptop (Windows, Node 24): ~0.35s for 1M personas × 3
  claims. Output: per-claim stance distribution, objection histogram, migration
  share table, polarization index — plus the honesty block.
- **materialize.ts** — `lazyPersona(population, model, personaId, claimId?,
  memory?)` computes one persona's view on demand. The rationale is a template
  assembled from the archetype description, the two dominant traits, and the
  model's own weights. The persona memory log (`appendMemory` / `getMemory`) is
  a pure value: append returns a new log, nothing is mutated, and a repeated
  interview of the same persona + claim returns identical output. A remembered
  statement is quoted verbatim in the rationale.

## Server surface

- `personas({action:'fabricate', count<=1_000_000, archetypeWeights?, seed?})`
  — mints and activates a population for the world; returns archetype shares,
  trait means, seed, honesty block.
- `personas({action:'materialize', personaId, claimId|claimText})` — one
  persona's deterministic view; claims derived from `claimText` hash into a
  stable id (`text:<hash>`).
- `personas({action:'remember', personaId, text})` — appends to the persona's
  memory log; later materializations reference it deterministically.
- `sim({action:'summary'|'timeline'})` — includes the fabric honesty block when
  a population is active for the world.

Persistence is minimal by construction: the world directory carries
`.murmur/<slug>/fabric.json` with the spec (count, weights, seed), the fitted
model JSON and the memory log — never the population. The population replays
from the seed on demand, so even 1M personas cost kilobytes on disk. Restart
rehydration refabricates lazily and deserializes the model.

## Honesty (mirrors METHODOLOGY.md)

1. **Every fabric-derived output prints the honesty block**: `personaCount`
   together with the surrogate's holdout metrics (`holdoutAccuracy`,
   `labeledCount`, `effectiveSampleSize`) and, verbatim:
   *"surrogate personas — a compressed model of labeled opinions, not data
   about real people"*.
2. **A claim without a fitted head is UNCALIBRATED.** Claim-scoped predictions
   never fall back to the pooled head; `massEvaluate` reports uncalibrated
   claims with zero counts and `calibrated: false`.
3. **Never describe personas as real people, never present N as N independent
   opinions.** N is the size of a fabricated population; the only "sample" is
   the labeled examples, and `effectiveSampleSize` is exactly `labeledCount` —
   no resampling, no synthetic boosting of evidence.
4. **The surrogate is a compression of the labels it was given.** If the labels
   are thin, biased or wrong, the fabric reproduces that faithfully — see
   Seshadri et al. (ACL 2026) and Chen et al. (arXiv 2607.26348) in
   METHODOLOGY.md for why LLM-free compression is the honest end of this
   spectrum, and why the output is a hypothesis generator, not a measurement.
5. **Polarization is a reparameterization**, computed as
   (committed ÷ population) × (0.5 + 0.5 × camp balance) — the same arithmetic
   the report uses. It is not an uncertainty interval.
6. **Determinism is the falsifiable claim**: same spec + same labels + same
   seed ⇒ byte-identical aggregates. `tests/unit/fabric-determinism.test.ts`
   enforces it; the golden replay contract of the engine is untouched.

## Tests

`murmur/tests/unit/fabric-*.test.ts` — determinism/replay, fit quality on
separable data, 1M-persona massEvaluate (generous 5000ms CI ceiling), lazy
materialization identity/variety, memory consistency, server tool behavior and
honesty-block presence. All offline, no skips.
