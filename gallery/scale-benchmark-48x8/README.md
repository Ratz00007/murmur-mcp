# Gallery entry — scale benchmark 48 × 8 (MOCK, engine-only)

**Status: not a product run.** This entry is a *engine measurement*, not a
crowd-reaction result: the host LLM was replaced by the deterministic mock brain.
It exists so the flagship's cost envelope is public and reproducible. Content
quality is explicitly **not** measured here.

| field | value |
|---|---|
| client | none (headless script: `tools/scale-benchmark.mjs`) |
| model | **MOCK** — deterministic mock brain, no LLM involved |
| personas / rounds | 48 / 8 |
| platforms | both |
| seed | `flagship-scale-48x8` |
| ensemble runCount | 5 (default) |
| wall time (engine) | 2.98s |
| generation items | 160 (20 activated personas × 8 rounds) |
| input (task payloads) | ≈ 85,402 est. tokens (chars/4) |
| output (content authored) | ≈ 10,918 est. tokens |
| round trip | ≈ 96,320 est. tokens |
| report markdown | 26,070 chars |

Default-scale comparison (24 × 8): 80 items, ≈57.8k in / ≈6.5k out, ≈64.3k round
trip, 1.41s.

Reproduce: `node tools/scale-benchmark.mjs 48 8`

**What we would change:** the real number that matters is *billed* tokens from a
real host model, and this run cannot produce it. It also cannot say whether 48
personas produce a better report than 24 — only the flagship run (see
`murmur-demo/FLAGSHIP-DEMO.md`) can settle that, and the honest expectation is
that quality scales sub-linearly with persona count until the persona mix is
deliberately stratified.
