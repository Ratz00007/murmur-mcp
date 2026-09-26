# GOOD FIRST ISSUES — starter tasks for new contributors

Picked to be small, safe and self-contained: every issue names the file(s),
the expected behavior, and the acceptance criteria. All must keep the
deterministic contract — new randomness must ride `streamRng` (the unit test
`engine.test.ts > contains no unseeded randomness` enforces it).

1. **Adapter for one more coding agent** — `murmur/packages/adapters/src/index.ts`.
   Add an install snippet for a client not yet covered (check the file's client
   list). Acceptance: `vitest run --project unit` passes; the entry appears in the
   client's list from `murmur-mcp init` and in `murmur-mcp init --client <id>`.
   (`murmur-mcp adapters` is not a CLI action — valid ones are `serve`, `doctor`,
   `init`, `templates`, `version`, `help`.)
2. **Lexicon coverage for voice templates** — `murmur/packages/engine/src/sentiment.ts`
   + `tools/lexicon-audit.cjs`. Add 20+ domain words (finance slang, developer
   slang). Acceptance: audit script reports higher coverage, no test changes.
3. **Doctor check: Node version floor** — `murmur/packages/server/src/cli.ts`
   (`doctor` command). Warn when Node < 20 with an actionable message.
   Acceptance: `murmur-mcp doctor` output mentions the floor on Node 18.
4. **Report header honesty line** — `murmur/packages/engine/src/report.ts`.
   Ensure every rendered report carries the "simulated perspective, not a
   validated forecast" line (add the test in `tests/golden/citation-integrity.test.ts`).
5. **Quote-truncation consistency** — `murmur/packages/engine/src/report.ts`
   `quoteLine` vs `tests/golden/citation-integrity.test.ts` truncation helpers.
   Extract ONE shared helper; acceptance: integrity test still green.
6. **Cascade audit entry cap docs** — `murmur/packages/engine/src/sim/ingest.ts`
   (`audit.slice(0, 400)`). Document the cap in the function header + add a unit
   assertion that a 2-hop cascade never emits more than 400 audit rows.
7. **Zipf exponent smoke test** — `murmur/packages/engine/src/graph.ts`.
   Add a bounds test: with exponent 1.8 over 64 personas, the top 20% hold
   ≥ 40% of in-degree on 3 fixed seeds. See `tests/unit/graph.test.ts`.
8. **Calibrate: bounded-quadratic convergence** — extend
   `murmur/packages/engine/src/calibrate/calibrate.test.ts` with a case that
   starts at a bound corner and still converges within `iters` sweeps.
9. **Ensemble band rendering in HTML** — `murmur/packages/engine/src/report-html.ts`.
   The P10–P90 band renders, but add a numeric caption under the SVG with the
   final-round band width; acceptance: new assertion in e2e HTML checks.
10. **Gallery entry template** — `/gallery/_TEMPLATE/`. Improve the contributor
    checklist (model, token count, wall time, client version). Acceptance:
    `gallery/README.md` links it and the demo's own entry follows it.

How to run checks: `cd murmur && npm install && npm test`
(unit + golden), `npm run test:e2e` for the full stdio run.
