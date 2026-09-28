# GOAL — Murmur: Reposition, Prove, and Harden to 20/10

**Objective**
Complete all remaining and pending work: reposition Murmur from "predicts your
audience's reaction" to "finds the objections that will kill the change, and
tells you which ones to test with a real human"; fix every real defect found in
audit; run a pre-registered benchmark against real observed reactions; and bring
engineering, protocol conformance, and launch readiness to the highest bar
achievable today.

**Status:** active

**Replaces:** the prior "Murmur Phase 0 + Phase 1: Ship, Prove, and De-risk"
goal. Two of its claims are **disproved by direct inspection** and are corrected
in the log below rather than carried forward:
- "Sentinel's workspace-jail helper was defined but NEVER CALLED — wired it in
  myself" — **it was never wired.** `assertInsideWorkspace` is defined at
  `murmur/packages/server/src/tools/seeds.ts:13` with **zero call sites** (verified
  by grep over the whole repo and by inspecting the built `dist/index.js`). The
  e2e test that "covers" it passes because the canary file does not exist, not
  because a jail works. `murmur/SECURITY.md:43` was the only accurate doc.
- "test counts unified to 66" — the real count is **69** unit+golden (measured,
  not read off a doc). Nine files say 66; `PROJECT-WORKLOG.md` says 42.

**Why reposition at all.** The original premise is empirically dead. Seshadri et
al., *"Lost in Simulation"* (ACL 2026) measures LLM-simulated users at ECE
15–20 points against real users, with results swinging 9pp by simulator model.
Chen et al., *"When Synthetic Users Fail"* (arXiv 2607.26348) finds no LLM beats
the best non-LLM baseline on real survey data. Meanwhile Socialtrait claims 86%
predictive accuracy with no method, Simile has raised $200M, and Reevemark ships
Sentinel. So a 20/10 Murmur cannot compete on predictive accuracy. It competes
on **published error rate, zero API keys, and a workflow that fits inside a
coding session** — by showing its work, including where it is bad.

---

## Success criteria

### A. Truth and safety — no real defects remain
- [ ] A1 `assertInsideWorkspace` called from `seed_add_files`, using `realpath`
      so a symlink cannot escape; negative test creates a real file outside the
      root and asserts it is refused
- [ ] A2 `createMessage` bound at `murmur/packages/server/src/server.ts:49`; the
      sampling accelerator is reachable; test proves it
- [ ] A3 `patchPersona` and `deleteMemories` carry a `world_id` predicate
      (`murmur/packages/engine/src/store/storage.ts:421,487`) — today a `p_1`
      in two worlds is overwritten in both
- [ ] A4 Zero hardcoded test counts in docs; a script generates them and CI
      fails on disagreement
- [ ] A5 `*.db`, `*.db-wal`, `*.db-shm` gitignored
- [ ] A6 The committed `murmur-demo/.murmur/` and `gallery/` reports match the
      code that generates them (CI is currently green while they contradict it)

### B. Credibility core
- [ ] B1 `claim_verify` rejects a report draft containing a number not in the
      stats pack; negative-control test included
- [ ] B2 Tautological metrics (`organicEngagementShare` — structurally zero by
      construction at `sim/ingest.ts:462` — plus `polarization`, `controversy`,
      `momentum.pct`, `maxDivergence`, `projectCurve.direction`) are either fixed
      or removed from both renderers
- [ ] B3 `METHODOLOGY.md` states plainly that personas are invented, the band is
      slope sensitivity not uncertainty, and nothing is a measurement
- [ ] B4 "ensemble" renamed to sensitivity everywhere, including the relabel
      currently sitting uncommitted in the working tree

### C. The Objection Dossier
- [ ] C1 New report artifact: ranked objections with steelman, evidence, blast
      radius, the counter-case, the weakest load-bearing claim, and a ranked
      test plan
- [ ] C2 Renderer keeps the self-contained offline HTML properties (no JS, no
      external refs, prints clean)

### D. MurmurBench
- [ ] D1 ≥5 verified (announcement, reaction) pairs, public and citable
- [ ] D2 Ground-truth objections extracted per the frozen rubric and hand-audited
- [ ] D3 Pre-emption rate reported beside every recall figure
- [ ] D4 Arm A (naive baseline) and Arm B (full Murmur) run on the same blind inputs
- [ ] D5 **Kill criterion applied and published**: Arm B mean recall@10 must beat
      Arm A by ≥0.15 absolute, or the simulation engine is cut and the product
      becomes the thin version. The result is published either way.

### E. Engineering
- [ ] E1 Coverage configured and gated in CI (currently *no* coverage measurement exists)
- [ ] E2 Dedicated tests for the untested giants: `report.ts` (891),
      `analytics.ts` (620), `sim/ingest.ts` (584), `opinion.ts` (152),
      `ensemble.ts` (115)
- [ ] E3 `packages/server` unit tests (1,884 LOC currently has one happy-path e2e)
- [ ] E4 Lint (Biome) + `noUnusedLocals`, which would have caught all six `void x;` dead-code suppressions
- [ ] E5 Typecheck `tests/`, `prompts`, `adapters`, `templates` — never typechecked today
- [ ] E6 Cross-Node golden hash in CI on 20/22/24 × 3 OSes (promised in the old GOAL, never done)
- [ ] E7 MCP 2026-07-28 conformance: `outputSchema` on all tools (0 of 29 today) or stop emitting `structuredContent`; `tasks`, `elicitation`, resource-template `complete`, `logging` over MCP
- [ ] E8 Tool count 29 → ~11 with a CI assertion that the advertised count matches registration; duplicate `world_config`/`sim_configure` merged

### F. Launch
- [ ] F1 Docs reduced from ~3,500 lines to ~600; one README, one CHANGELOG, one METHODOLOGY, one BENCHMARK
- [ ] F2 README cites the two 2026 papers that say the old category does not work
- [ ] F3 MCP registry `server.json` + directory submission drafts
- [ ] F4 `murmur-diff`: re-run on an edited seed → line-level objection delta

### Blocked on the user
- `npm login` + publish — the `murmur-mcp` name is unclaimed. Runbook:
  `murmur/packages/server/PUBLISH-CHECKLIST.md`.
- Second person to score Arm A vs Arm B. At N=5 a single operator is tolerable
  only if the answer key is written before any arm output is seen; at N=20 it
  is not, and a second reviewer is required.

---

## Progress log

- 2026-09-23 — Prior goal set. 8-expert panel scored the repo PMF 3/10,
  MCP-readiness 6/10, scientific credibility 4/10, launch readiness 2/10.
- 2026-09-26 — 15-agent team completed Phase 0/1. Repo public, CI green.
- 2026-09-28 — **Brutal review.** 5.5/10 overall: engineering 8, honesty 9,
  scientific validity 2, differentiation 4, launch readiness 3. Root cause:
  the whole chain is an LLM writing fiction, scored by a ~200-word lexicon
  (`sentiment.ts:8`), shuffled by hardcoded Deffuant dynamics
  (`opinion.ts:53`). Nothing has ever been compared to a real human reaction.
  `calibrate/calibrate.ts:4-11` carries a 20-line warning about circular
  validation and **zero callers**.
- 2026-09-28 — **Four real defects confirmed by inspection**, none previously
  fixed: the unwired jail (A1), the detached `createMessage` (A2),
  cross-world `WHERE id=?` corruption (A3), and 0-of-29 `outputSchema` against
  `structuredContent` emitted on every response (`session.ts:85,92,109`).
- 2026-09-28 — **MurmurBench-0 sealed** at `bench/PROTOCOL.md` (commit `e700a3e`),
  with the kill criterion fixed in advance and amendments required to be visible.
- 2026-09-28 — Three protocol amendments, each recording what was observed before
  it: the mechanical filters could not express question-vs-announcement
  (`79045c2`); a verb test could not distinguish vendor from bystander, and
  bystanders are the population under test, so using them as ground truth is
  circular (`42ef5d5`); Reddit is dense with reactions and thin on announcements,
  so announcement and reaction must come from two different places (`7157960`).
  The third also declares a confound — prepared vendor announcements pre-empt
  their own objections — and a **pre-emption rate** control, with the arm
  *difference* named primary and absolute recall declared inflated.
- 2026-09-28 — Selection pipeline built and screens verified working. Four
  genuine pairs found: Hetzner price adjustment, Scaleway pricing update,
  ONLYOFFICE licence violation, Flathub licence compliance. Selection revised 11
  times; **stopped deliberately** rather than tuning to reach N=5, because
  continuing would be the exact post-hoc selection bias the seal exists to
  prevent. Next: find pairs by searching vendor *names* rather than searching for
  announcements, and/or move ground truth to GitHub issues and HN where the
  reaction thread and the announcement share a URL by construction.
