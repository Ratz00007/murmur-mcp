# RELEASE CHECKLIST — Murmur

Everything the *code* can do is done and verified (see "Verified" below). What
remains is distribution and one piece of proof. Work top to bottom; step 2 is
the hard blocker and step 3 is the credibility blocker.

## Verified in this repo (re-run any time)

```bash
cd murmur
npm install          # builds dist automatically (root `prepare` script)
npm test             # 66 unit + golden tests — includes citation-integrity + byte-replay
npm run test:e2e     # 2 e2e tests: real MCP SDK client ↔ server over stdio
npm run cleanroom    # release gate: no network APIs, no URLs, no key surfaces, <120s to first world
node ../tools/scale-benchmark.mjs 48 8   # token budget + wall time at any scale
```

Last run of record: 66/66 unit+golden, 2/2 e2e, cleanroom **GATE GREEN** (7/7
checks, 0.41s time-to-first-world), engine+server+templates typecheck clean.

---

## 1. Create the GitHub repo and push (BLOCKER)

The repo root is **this directory** (`murmur/`, `murmur-demo/`, `tools/`,
`gallery/` as siblings) — `tools/*.mjs` resolve `../murmur` and `../murmur-demo`,
so pushing a subdirectory would break them.

- The two commits are already made locally: `chore(repo): bundle-root repository
  layout` on top of `feat(phases-0-3): …`. Monorepo history is preserved (101
  files moved as pure renames).
- `murmur/.git.bundle-history/` is the **original** monorepo git dir, kept as a
  backup and gitignored. Delete it once you are happy with the new repo.

```bash
cd <this directory>
git remote add origin https://github.com/Ratz00007/murmur-mcp.git
git push -u origin main
```

If you publish under a different org/repo, update: the badge URLs at the top of
`README.md`, and `repository` / `homepage` / `bugs` in
`murmur/packages/server/package.json` (they currently point at
`github.com/Ratz00007/murmur-mcp`).

- [x] Repo pushed — github.com/Ratz00007/murmur-mcp (private, branch `main`)
- [ ] CI green on GitHub (workflow: `.github/workflows/ci.yml`)

## 2. Claim the npm name and publish with provenance (BLOCKER)

`npm view murmur-mcp` still returns 404 — every `npx -y murmur-mcp` instruction
in the README fails until this is done.

```bash
cd murmur/packages/server
npm login                 # or add an NPM_TOKEN repo secret and use the workflow
npm publish --provenance --access public
```

The release workflow (`.github/workflows/release.yml`) already runs the
cleanroom gate + tests and publishes with provenance on a GitHub release. Ship
the npm artifact **only** through that path — publishing from a local machine
loses the provenance attestation, which is exactly what the deleted hand-packed
tarball was criticized for.

- [ ] npm name claimed, v1.0.0 published with provenance
- [ ] `npx -y murmur-mcp doctor` works on a clean machine
- [ ] README Option A no longer says "not published yet" (two places)

## 3. Run the flagship with a real LLM (CREDIBILITY BLOCKER)

The bundled demo is mock-driven and says so. Until one real-LLM run is published,
the strongest objection stands: *"nobody has shown what an actual model produces
through this pipeline."*

Protocol: `murmur-demo/FLAGSHIP-DEMO.md` (48 personas · 8 rounds · both
platforms · inject at round 4). Config: `murmur-demo/flagship.config.json`.

- [ ] Run it inside Claude Code / Codex CLI / Gemini CLI
- [ ] Publish verbatim transcript + `report-1.md` + `report-1.html` into `gallery/flagship-<client>-<model>/` (use `gallery/_TEMPLATE/CHECKLIST.md`)
- [ ] Fill the results table in `FLAGSHIP-DEMO.md`
- [ ] Replace the "Pending: median billed tokens" line in README → Token cost with the measured figure
- [ ] Add the row to `gallery/INDEX.md`
- [ ] Publish it even if the report is unflattering — that is the point

## 4. Launch wave (only after 1–3)

- [ ] Directory submissions, each written for that directory (mcp.so, Smithery,
      Glama, the official MCP registry, awesome-MCP lists)
- [ ] Show HN / relevant subreddits: lead with **reproducibility + citation
      integrity + zero-key**, not "predictions"
- [ ] Link the gallery and the cleanroom gate in the launch post
- [ ] Never: buy stars/placements, cross-post identical text, or keyword-stuff a
      competitor's trademark (the NOTICE binds comparisons to factual claims)

## 5. Post-launch (not blockers)

- [ ] MurmurBench: curate 10–20 well-documented past events, replay them, publish
      scores (`tools/scale-benchmark.mjs` is the pattern for reproducible harnesses)
- [ ] Calibration data: real engagement datasets → `packages/engine/src/calibrate/`
      (never self-generated data — the module header explains why)
- [ ] Inter-model agreement as a published confidence signal (same seed × 3 models)
- [ ] Techniques write-up: Deffuant dynamics + cascade + ensemble UQ

## Claims policy (keep it true after launch)

Use: "simulated perspective", "evidence-cited", "reproducible", "zero-key".
Avoid: "analyst-grade", "#1", "best", "predicts the future", "forecast".
Do not add an optional `MURMUR_LLM_API_KEY` — it would destroy the zero-key
positioning, the cleanroom gate, and the install-friction advantage at once.
