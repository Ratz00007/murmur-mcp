# HANDOFF.md — OpenCode takeover brief

Copy everything under "THE PROMPT" below into OpenCode as the first message.

---

## THE PROMPT

You are taking over the **Murmur** project at `C:\Users\ratin\Desktop\murmur-mcp`.
Read this whole brief before touching anything. Do not re-litigate settled decisions.

### 1. What this project is

Murmur is a **zero-API-key MCP server that simulates crowd reaction** to a pending
announcement (pricing change, product launch, PR crisis). It is *deterministic*: the
engine has one runtime dependency, a seeded PRNG (mulberry32), zero `Math.random` on
simulation paths, and a golden byte-replay test. The "brains" (persona voices) are
supplied by the **host LLM** — the user of Claude Code / Codex / OpenCode — which is
why there is no API key and no network egress.

Five-package TypeScript monorepo, ~10.5k lines, in `murmur/`:
`engine` (all logic) · `server` (MCP tool surface) · `templates` (scenario packs) ·
plus test/CLI harnesses.

### 2. Repo / git state (verified at handoff)

- Repo root: `C:\Users\ratin\Desktop\murmur-mcp` (git root is HERE, not in `murmur/`)
- Branch `main`, working tree **clean**, HEAD `4939be3`
- Remote `origin` = `https://github.com/Ratz00007/murmur-mcp.git` — **already exists**
- `origin/main` is at `49378ce`; local `main` is **2 commits ahead (unpushed)**:
  `35d7e96`, `4939be3`
- Monorepo history preserved via `murmur/.git.bundle-history/` (backup, gitignored)
- Repo URLs are already patched to `Ratz00007` in `README.md` and
  `murmur/packages/server/package.json`

### 3. What is DONE and verified (do not redo)

All four phases of the plan in `ANALYSIS-AND-ROADMAP.md` are complete:

- **Phase 0** — engagement formula unified into a single canonical function
  (`murmur/packages/engine/src/util/engagement.ts`); per-world post IDs; honest RNG
  test; PDF inflate cap; unverifiable `.tgz` + committed `.db` deleted; all
  "analyst-grade" claims downgraded; measured token-cost section
- **Phase 1** — gallery infrastructure + first real run; positioning docs
- **Phase 2** — Deffuant opinion dynamics (`packages/engine/src/dynamics/opinion.ts`,
  wired at `sim/aggregate.ts`), seeded ensemble P10–P90 bands
  (`dynamics/ensemble.ts`, rendered in `report.ts:122` + `report-html.ts:576`),
  cascade/topology engagement, calibration scaffold (`calibrate/calibrate.ts`),
  citation-integrity test
- **Phase 3** — 6 scenario packs, worked-playbook API, `GOOD-FIRST-ISSUES.md`,
  issue templates, flagship protocol, gallery

**Verification commands — all currently GREEN, run them before you claim anything:**

```powershell
cd C:\Users\ratin\Desktop\murmur-mcp\murmur
npx vitest run --project unit --project golden    # 66 passed
npx vitest run --project e2e                      # 2 passed
node tests/cleanroom/gate.mjs                      # GATE GREEN

### 4. What is NOT done — the three launch blockers

**BLOCKER 1 — 2 unpushed commits.** Push is the only remaining step:
```powershell
cd C:\Users\ratin\Desktop\murmur-mcp
git push -u origin main
```
If push is rejected (auth), stop and report — do not rewrite history.

**BLOCKER 2 — npm name is UNCLAIMED.** `registry.npmjs.org/murmur-mcp` returns
**404** as of handoff. Every `npx -y murmur-mcp` install command in `README.md`
therefore fails today. This requires a human with an npm account:
1. Claim the name (or pick a new one — if renamed, patch `README.md`,
   `murmur/packages/server/package.json`, and the badge URLs together)
2. Add `NPM_TOKEN` as a repo secret
3. `.github/workflows/release.yml` then runs every gate and publishes **with npm
   provenance** — do not weaken that workflow

**BLOCKER 3 — no client-IDE flagship run.** The only real run is LLM-authored
(`gallery/llm-authored-run-12x4/`). Three attempts to drive Claude Code CLI
headlessly FAILED and are honestly recorded in `tools/flagship-16x8/`. The failure
was model access, not code. Protocol for a human-run flagship:
`tools/flagship-16x8/RUN-PROTOCOL.md`, checklist `gallery/_TEMPLATE/CHECKLIST.md`.

### 5. The claims policy — read this, it is binding

This project deliberately does **NOT** claim: best-in-category, #1, analyst-grade,
predictive, accurate, realistic. The report template hard-codes the disclaimer
"Simulated perspective, not a validated forecast". `ANALYSIS-AND-ROADMAP.md` lists
the kill-shots. If you write marketing copy, tool descriptions, or release notes,
you must stay inside claims that are literally true today. Do **not** add an optional
`MURMUR_LLM_API_KEY` escape hatch — it destroys the entire zero-key positioning in
one line. Do **not** put an LLM inside the opinion/diffusion loop — that would break
byte-level determinism, which is the entire moat.

### 6. Priorities for you, in order

1. **Push** (Blocker 1). Then confirm CI is green on GitHub.
2. **Do not** attempt to fake Blocker 3. If you cannot run a real client session,
   leave the gap documented rather than papering over it.

### 7. Key file map

| Path | What it is |
|---|---|
| `README.md` | public front page — badges, install, positioning |
| `ANALYSIS-AND-ROADMAP.md` | the 6.6/10 baseline review, 4-phase plan, kill-shots |
| `GOAL.md` | running work log incl. what is blocked and why |
| `RELEASE-CHECKLIST.md` | ordered launch steps + copy-paste commands |
| `PROJECT-WORKLOG.md` | original project worklog |
| `murmur/packages/engine/src/` | **all engine logic** — start at `index.ts` (the export surface) |
| `murmur/packages/engine/src/util/engagement.ts` | the one canonical engagement formula |
| `murmur/packages/engine/src/report.ts` / `report-html.ts` | report rendering (large god-modules) |
| `murmur/packages/server/src/tools/` | MCP tool definitions, one file per stage |
| `murmur/tests/cleanroom/gate.mjs` | no-egress / no-API-key release gate |
| `tools/host-llm-run/run.mjs` | headless driver for LLM-authored runs (`init` / `submit N` / `report`) |
| `tools/host-llm-run/brain/` | the authored content for the published run |
| `tools/host-llm-run/check-gallery.mjs` | gallery gate, wired into CI |
| `tools/scale-benchmark.mjs` | token-volume + engine-speed measurement |
| `tools/flagship-16x8/` | client-run flagship protocol + honest failure record |
| `gallery/llm-authored-run-12x4/` | the published real run (12 personas, 4 rounds, 19 posts) |
| `.github/workflows/ci.yml` | unit/golden/e2e + gallery gate |
| `.github/workflows/release.yml` | gated publish with npm provenance |
| `.murmur/` | local run database + rendered reports (gitignored) |

### 8. Hard-won constraints — do not regress these

- **Determinism is the product.** No `Math.random` in sim paths, no wall-clock, no
  unseeded RNG. `murmur/tests/cleanroom/` and the golden replay test enforce it.
- **The engagement formula must stay unified.** It was duplicated into ~5
  contradictory variants (downvotes *added* heat in one path). Any new call site
  must import the canonical function.
- **Citations must resolve.** Every `po_N` in a report must be a real stored post;
  the gallery gate enforces this. Do not hand-edit reports.
- **The report must keep its limitations section** — including that sentiment is
  keyword-attributed and can be sparse.
- Repo root is the bundle root, not `murmur/`. `tools/*.mjs` resolve `../murmur` and
  `../murmur-demo` as **siblings**. Do not move `murmur/`, `gallery/`, `tools/` or
  `murmur-demo/` relative to each other.

### 9. Style

Match the existing code: TypeScript strict, no new runtime dependencies in
`packages/engine`, comments that explain *why* not *what*, and honest docs over
promotional ones. When you finish a task, state what you verified (with the command
output) and what remains blocked.

**First action: run the four verification commands in §3, then push.**

3. Highest-value engineering left, all post-launch:
   - **MurmurBench** — backtest 10–20 documented past events, publish scores openly
     (even mediocre scores beat a superlative, because they are honest)
   - **Real calibration** — fit engagement params in `calibrate/calibrate.ts`
     against *real public engagement data*, never against Murmur's own output
     (that would be circular). It is currently imported only by its own test.
   - Raise unit coverage on `store/storage.ts` and the PDF ingest path
4. Growth/distribution (after 1–3): mcp.so, Smithery, Glama, official MCP registry,
   awesome-MCP. Factual comparison positioning only (Apache-2.0, zero-key, offline,
   deterministic vs MiroFish's keys/cloud/AGPL — NOTICE/attribution obligations apply).

cd ..
node tools/host-llm-run/check-gallery.mjs          # GALLERY GATE: GREEN
```
