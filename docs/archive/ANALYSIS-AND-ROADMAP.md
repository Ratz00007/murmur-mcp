# Murmur — analysis & roadmap

This document preserves the review that produced the current codebase and the
plan the project is executing. It is the "why" behind the commits in
`murmur/`, and it is deliberately blunt.

Provenance: three parallel expert reviews (simulation science, LLM-product/
ecosystem strategy, OSS growth) plus a code/QA/product critique pass, run
against the v1.0.0 bundle. Scores below are that panel's, not marketing.

## 1. Baseline verdict on v1.0.0 (before this work)

| Axis | Score | One-line reason |
|---|---|---|
| Architecture | 7/10 | sharp package boundaries, real seeded determinism — but god-module report layer |
| Code quality | 6/10 | engagement formula duplicated in 4 inconsistent variants across ~14 sites |
| Test quality | 6/10 | strong determinism + e2e, but "unit" was one static-assertion file |
| Security/release | 6.5/10 | clean secret hygiene, but a PDF decompression DoS and unverifiable shipped binaries |
| Originality/market | 6.5/10 | real niche (in-IDE crowd sim), thin moat, no eval |
| Docs/demo | 7.5/10 | strongest area — but the demo's "LLM" was a mock |
| **Consensus** | **6.6/10** | *"genuinely solid engineering, oversold product"* |

The three objections that mattered: (1) **"analyst-grade" claims rested on a
23-post toy run with a 2-point linear extrapolation**; (2) **the core value —
LLM persona voices — was never demonstrated with a real LLM**; (3) the token
cost of "zero-key" was never quantified.

## 2. Target position

**Agent-native, in-IDE crowd-reaction simulation** — a niche with no incumbent.
Hosted sims need API keys and live in the cloud; a raw "simulate a crowd" prompt
has no infrastructure. Murmur's axis is different: *reproducible, evidence-cited,
offline, inside the editor*.

## 3. Phase plan and status

### Phase 0 — stop the bleeding ✅ shipped
- [x] One canonical `engagementScore()` replacing 5 variants across 14 sites (`packages/engine/src/util/engagement.ts`)
- [x] Post ids scoped per world (`countPosts(worldId)`) — cross-world replay no longer leaks
- [x] "No unseeded randomness" test now scans the whole package with documented, justified exclusions
- [x] PDF ingest capped (`maxOutputLength`) — no decompression bomb
- [x] Hand-packed tarball + committed demo `.db` removed from the bundle
- [x] Oversold claims downgraded ("simulated perspective, not a validated forecast")

### Phase 1 — make it real ✅ code / ⏳ distribution
- [x] Repo layout that survives a push (tools + demo + gallery siblings)
- [x] Badges, `prepare` build script, honest token-cost section
- [x] Gallery infrastructure with an explicit MOCK-labelling rule
- [ ] GitHub repo pushed ← **needs an account action** (`RELEASE-CHECKLIST.md` §1)
- [ ] npm name claimed, published with provenance ← **§2**
- [ ] First real-LLM run published ← **§3, the one remaining credibility item**

### Phase 2 — science & evals ✅ shipped
- [x] Deffuant bounded-confidence opinion dynamics + abstention (`dynamics/opinion.ts`)
- [x] Degree-heterogeneous topology (zipf + preferential attachment, `graph.ts`)
- [x] Seeded multi-hop cascade engagement (`sim/ingest.ts`)
- [x] Ensemble P10–P90 projection bands replacing the clamped 2-point line (`dynamics/ensemble.ts`, `report.ts`, `report-html.ts`)
- [x] Citation-integrity test: every `po_N` resolves, quotes match stored bodies, headline stats recompute
- [x] Coordinate-descent calibration scaffold with an explicit anti-circular-validation policy
- [ ] Backtesting against real past events (MurmurBench) — research backlog
- [ ] Calibration against real engagement datasets — research backlog

### Phase 3 — category ownership ✅ assets / ⏳ launch
- [x] Sixth scenario pack (recall / trust crisis) + worked-playbook exports
- [x] `GOOD-FIRST-ISSUES.md`, issue templates, contributor checklist
- [x] Flagship protocol for 48 personas × 8 rounds + measured cost envelope
- [x] Measured token budget published (24×8 ≈64.3k, 48×8 ≈96.3k est. round trip)
- [ ] Directory submissions + launch post — after §1–§3 of the checklist

## 4. Guardrails (agreed kill-shots)

1. Never claim "analyst-grade", "#1" or "best" without a published benchmark.
2. Never add an optional API key (`MURMUR_LLM_API_KEY`) — it destroys the
   zero-key positioning, the cleanroom gate and the install-friction advantage.
3. Never put an LLM in the opinion/diffusion loop, and never put hosted
   sentiment on the critical path: the deterministic engine *is* the moat.
4. Never fight hosted simulators on agent count — win on checkability.
5. Never publish mock output unlabelled; the gallery's MOCK rows exist for this.
6. Unify mechanics (engagement, cascade, topology) before adding platforms.

## 5. Metrics that define success

| Layer | Signal |
|---|---|
| Activation | npm weekly downloads → first `world_init` conversion |
| Proof | third-party gallery entries; ≥10 by month 2 |
| Distribution | star *velocity*, directory rank on "social simulation MCP" |
| Credibility | 100% citation integrity in CI · backtest scores published · median tokens/report tracked |
| Community | ≥1 merged community PR/week by month 2 |

## 6. Research backlog (not launch blockers)

1. **MurmurBench**: 10–20 well-documented past events, replayed and scored.
2. **Calibration**: real engagement data → `packages/engine/src/calibrate/`
   (never self-generated data — see the module header).
3. **Inter-model agreement as confidence**: same seed × 3 host models, publish
   the variance as the report's confidence signal.
4. **Techniques write-up**: Deffuant dynamics + cascade + ensemble UQ.
5. **Persona stratification**: does 48 personas beat 24? Measure, don't assume.
