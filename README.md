# Murmur — Complete Project Bundle · v1.0.0

<!-- Badge row — placeholders until the repo/package are live.
     TODO(repo): replace TODO(repo) in the URLs below with the real repository path (e.g. your-org/murmur-mcp). -->
[![build](https://img.shields.io/github/actions/workflow/status/TODO(repo)/ci.yml?branch=main)](https://github.com/TODO(repo)/actions)
[![npm](https://img.shields.io/npm/v/murmur-mcp.svg)](https://www.npmjs.com/package/murmur-mcp)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](murmur/LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server%20%C2%B7%2029%20tools-brightgreen.svg)](murmur/README.md)

**Murmur** (`murmur-mcp`) is a zero-key social-simulation MCP server: point your
coding agent (Claude Code, Codex, Gemini CLI, Cursor, Windsurf, …) at it, and it
simulates how a crowd reacts to your news — pricing changes, launches, policy
updates, crises — then writes an analyst-style report (simulated perspective,
not a validated forecast) with a shareable HTML dashboard. All inference rides on the LLM you already pay for;
the server itself is deterministic, fully offline, and needs **no API keys**.

This zip is the whole project as built: source, tests, git history, demo world,
docs, and dev tooling.

> **NOTE** — Murmur reports are simulated perspectives grounded in the engine's
> recorded stats, not validated forecasts.

## Why Murmur — the agent-native crowd-sim

Murmur occupies one specific niche: **crowd-reaction simulation that runs
inside your AI coding agent**, with the receipts to back it up:

- **Agent-native** — the whole pipeline (seeds → personas → rounds →
  interviews → report) is 29 MCP tools plus prompt playbooks. There is no
  separate app, no hosted dashboard, no second subscription.
- **Reproducible** — seeded RNG everywhere (mulberry32 + FNV streams).
  Same seed + same inputs = same world and the same report, byte for byte,
  enforced by golden replay tests. Live-LLM competitors cannot offer this.
- **Evidence-cited** — every risk cites real `po_N` post ids that resolve to
  stored posts; a CI test (`tests/golden/citation-integrity.test.ts`) asserts
  100% citation integrity and recomputes the headline stats from the database.
  Claims you cannot click through to a post do not ship in the report.
- **Zero-key, zero-egress** — the server never calls a model and ships no
  network code; it works fully offline under Apache-2.0. All inference rides
  the host LLM you already pay for (see "Token cost" — zero-key is not
  zero-cost, and the cost is published there).
- **Uncertainty, not point forecasts** — the projection is a seeded ensemble
  (P10–P90 bands across N runs), labeled as a simulated perspective.

How that compares, factually:

| | Murmur | Hosted crowd sims | A raw "simulate a crowd" prompt |
|---|---|---|---|
| API keys required | none | yes (LLM + memory/hosting keys) | none |
| Works offline | yes (after `npm install`) | no | n/a (lives in your chat) |
| Reproducible (same-seed replay) | yes, byte-identical, tested | no — live API calls | no |
| Evidence trail (claim → stored post) | yes, CI-checked | sometimes (exported logs) | no |
| Cost transparency | published token methodology | vendor billing | hidden in your quota |
| Scale | dozens of personas, 8–40 rounds | up to millions of agents | whatever the context window holds |

Murmur does not try to out-scale hosted simulators — it is the instrument you
reach for when you want a **checkable, replayable reaction read inside the
editor**, before the announcement goes out.

## What's in this zip

```text
murmur-complete-v1.0.0/
├── README.md                  ← this file
├── PROJECT-WORKLOG.md         ← the full build journal (9 tasks, every design decision)
├── murmur/                    ← the monorepo — RUNNABLE (source + built dist + git history)
│   ├── packages/engine/       ← deterministic swarm engine: analytics, reports, HTML dashboard
│   ├── packages/server/       ← murmur-mcp: 29 MCP tools, CLI (serve/doctor/init/templates)
│   ├── packages/prompts/      ← 4 prompt playbooks (predict/simulate/interview/resume)
│   ├── packages/adapters/     ← install snippets for 10 coding agents
│   ├── packages/templates/    ← 5 scenario packs (launch/policy/crisis/finance/fiction)
│   ├── tests/                 ← unit · golden byte-replay · e2e over stdio · cleanroom gate
│   ├── docs/Murmur-PRD-Technical-Plan-v1.0.pdf   ← the original 24-page product/tech plan
│   ├── examples/              ← paste-ready sample inputs (pricing page, FAQ, changelog)
│   └── .github/workflows/     ← CI (Node 20/22/24) + npm release automation
├── murmur-demo/               ← a finished demo run you can open right now
│   ├── DEMO-TRANSCRIPT.md     ← narrated 34-tool-call session, start to report
│   ├── examples/              ← the inputs the demo ingested
│   └── .murmur/
│       ├── reports/pricing-reaction/report-1.html   ← ★ the dashboard — open this first
│       ├── reports/pricing-reaction/report-1.md     ← same report as diffable Markdown
│       └── graph.mmd · *.jsonl                      ← world state (murmur.db is runtime state — regenerated by a replay, not shipped)
└── tools/                     ← dev utilities (paths are portable — see below)
    ├── demo-live.mjs          ← replay the whole demo end-to-end through real MCP stdio
    ├── preview-report.mjs     ← run the pipeline fresh and print a new report
    ├── test-sentiment.mjs     ← sentiment-scorer scratchpad
    ├── lexicon-audit.cjs      ← lexicon coverage audit of the voice templates
    └── audit-voices.mjs       ← voice-template polarity audit
```

`murmur/` ships with `dist/` pre-built, so no TypeScript build step is ever
needed — but like any Node package it needs its three runtime deps
(`@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`) fetched once with npm.
`node_modules/` (97 MB) is excluded from the zip. Requires Node ≥ 20.

## ① Open the demo dashboard (10 seconds)

Double-click
`murmur-demo/.murmur/reports/pricing-reaction/report-1.html`.

It is fully self-contained — no scripts, no external requests, works offline —
and shows the simulated "Acme Cloud pricing change" projection: executive dashboard,
multi-entity sentiment chart, faction donut + cards, platform divergence,
persona spotlights, risk register with evidence, recommendations, and five
appendices. The Markdown twin (`report-1.md`) is the same data in diffable form.

Then skim `murmur-demo/DEMO-TRANSCRIPT.md` to see the 34 tool calls that
produced it.

## ② Connect it to your coding agent

One-time setup — pick either option:

```bash
# Option A — install from npm (release artifacts ship via npm with provenance
# once the repo is live; not published yet — use Option B until then)
npm install -g murmur-mcp
murmur-mcp doctor                                # environment check
npx murmur-mcp doctor                            # …or run one-off, no global install

# Option B — install deps inside the bundled monorepo (dist is pre-built)
cd murmur && npm install
```

Then register the server with your client — e.g. Claude Code:

```bash
# after Option A (global binary on PATH)
claude mcp add murmur -- murmur-mcp serve
# …or via npx, no global install
claude mcp add murmur -- npx murmur-mcp serve

# after Option B (direct path — no global install needed)
claude mcp add murmur -- node /<path-to>/murmur-complete-v1.0.0/murmur/packages/server/dist/index.js serve
```

Also handy:

```bash
murmur-mcp templates                           # browse the 5 scenario packs
murmur-mcp init --client claude-code --write   # writes the client config for you
```

The server speaks plain MCP over stdio. `murmur/README.md` has the full
10-client install matrix (Codex, Gemini CLI, Antigravity, OpenCode, Hermes,
Cursor, Windsurf, Cline/Continue, VS Code) with copy-paste snippets.

Once connected, ask your agent things like:
*"Simulate how r/devops reacts to our new pricing page"* — the agent drives
the 29 Murmur tools; the LLM you already pay for does the persona voices.

## ③ Develop, test, replay

```bash
cd murmur
npm install            # if you skipped Option B (dev toolchain: typescript, vitest, sqlite)
npm test               # 46 unit + golden tests (byte-identical replay)
npm run test:e2e       # 2 end-to-end: real SDK client ↔ server over stdio
npm run cleanroom      # zero-egress gate: no network APIs, no URLs, no key surfaces
npm run build          # rebuild dist from source (all 5 packages)
```

Replay the demo (rewrites `murmur-demo/.murmur/` deterministically — same seed,
same bytes, every time; needs the `npm install` above first):

```bash
node tools/demo-live.mjs
```

The five scripts in `tools/` resolve `murmur/` and `murmur-demo/` relative to
their own location, so the bundle can sit anywhere on disk.

## Publishing to npm (when you're ready)

1. Point `repository` / `homepage` / `bugs` in
   `murmur/packages/server/package.json` at the real GitHub repo
   (placeholders currently say `murmur-mcp` org).
2. Push the repo, add the `NPM_TOKEN` secret, and the release workflow
   (`.github/workflows/release.yml`) runs every gate and publishes with
   provenance — or simply `npm publish` from `murmur/packages/server/`.

The npm name `murmur-mcp` was still unclaimed at build time.

## The guarantees (why no API key)

- **Host-Powered Inference** — the server never calls an LLM and ships no
  network code. It prepares batched generation tasks; your coding agent's own
  LLM completes them as part of the session you already pay for.
- **Deterministic** — seeded RNG everywhere (mulberry32 + FNV streams,
  test-enforced). Same seed + same inputs = same world and the same report,
  byte for byte, enforced by golden replay tests.
- **Cleanroom-verified** — the gate asserts the published bundle contains no
  network APIs, no URLs, and no key/token surfaces. The HTML dashboard
  inherits this promise: open it offline and check for yourself.

## Token cost

Murmur ships **zero API keys** — the server itself never calls an LLM. What a
run consumes is *host-LLM generations* completed inside the coding session you
already pay for:

- world + persona drafting tasks (ontology and persona-voice submissions),
- per-round action sets — at the defaults of **24 personas × 8 rounds** that
  is on the order of **192 persona action-set generations** per run,
- report drafting tasks (plan → draft → risks → recommendations → confidence),

i.e. **order of hundreds of host-LLM generations per run** at defaults.

**Estimation method** (the same one the e2e tests use): `tokens ≈ chars / 4`.

**Measured from the bundled mock demo** (`murmur-demo/.murmur/` — mock brain,
12 personas · 5 rounds, a smaller run than the defaults above):

| Artifact | Measured | ≈ tokens (chars/4) |
|---|---|---|
| Report output `report-1.md` | 26,320 chars | ≈ 6.6k output |
| Round-1 generation batch prompt (reported in `DEMO-TRANSCRIPT.md`) | ≈ 932 tokens | as reported |
| Largest single host response, budget 12,000 (reported in `DEMO-TRANSCRIPT.md`) | 4,645 tokens | as reported |
| `audit.jsonl` / `interviews.jsonl` / `qa.jsonl` | 28 / 1 / 1 records (3,265 / 433 / 339 B) | ≈ 0.8k / 0.1k / 0.1k |

Real-LLM cost varies by model, provider pricing and prompt caching — the mock
demo figures above are engine-side measurements, not a cost proxy.
TODO: publish median tokens/report measured from the first real-LLM gallery run.

## Where to read more

| Topic | File |
|---|---|
| Project journal (how it was built) | `PROJECT-WORKLOG.md` |
| Original PRD + technical plan (24 pp) | `murmur/docs/Murmur-PRD-Technical-Plan-v1.0.pdf` |
| Install matrix, guarantees, layout | `murmur/README.md` |
| Release notes | `murmur/CHANGELOG.md` + `murmur/packages/server/CHANGELOG.md` |
| Clean-room + zero-key policies | `murmur/CONTRIBUTING.md` |
| Security / injection hardening | `murmur/SECURITY.md` |
| License | `murmur/LICENSE` (Apache-2.0) + `murmur/NOTICE` |
