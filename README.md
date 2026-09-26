# Murmur

[![build](https://img.shields.io/github/actions/workflow/status/Ratz00007/murmur-mcp/ci.yml?branch=main)](https://github.com/Ratz00007/murmur-mcp/actions)
[![npm](https://img.shields.io/npm/v/murmur-mcp.svg)](https://www.npmjs.com/package/murmur-mcp)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](murmur/LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server%20%C2%B7%2029%20tools-brightgreen.svg)](murmur/README.md)

**Before you publish a pricing or launch change, see how a panel of simulated users reacts inside the coding agent you already use—with no extra API keys or Murmur network calls, and every risk tied to the simulated post behind it.**

> [!IMPORTANT]
> Murmur produces a **simulated perspective**, not validated evidence of what real users will do. The included demo is mock-driven; it shows the workflow, not a live-model result.

## What you get

- **Pressure-test the reaction** to a pricing, launch, policy, or crisis decision before your audience responds.
- **Stay in your coding workflow** with Claude Code, Codex, Gemini CLI, Cursor, Windsurf, and other MCP clients.
- **Add no API keys or Murmur network calls**; model use stays inside the host agent you already use.
- **Trace every risk to the simulated post behind it**, so you can inspect the argument instead of trusting a summary.
- **Replay the same seed, inputs, and host model** to reproduce the same run.

**See the shipped dashboard in 3 clicks**

1. **Get the repository.** Clone it or download the repository archive.
2. **Reveal the hidden folder.** `.murmur` is a dot-folder, so macOS Finder hides it by default: choose **Go → Go to Folder** (`Cmd+Shift+G`), paste `murmur-demo/.murmur/reports/pricing-reaction`, and press Return. From the repository root, `open murmur-demo/.murmur/reports/pricing-reaction/report-1.html` also works on macOS; in Windows PowerShell use `start .\murmur-demo\.murmur\reports\pricing-reaction\report-1.html`; on Linux use `xdg-open murmur-demo/.murmur/reports/pricing-reaction/report-1.html`.
3. **Open `report-1.html`.** Double-click it to open the self-contained dashboard in your browser; no build or local server is required.

The 61 KB report covers Acme Cloud's 30% price increase with 7 supporters versus 5 opponents, five rounds of reaction, platform divergence, persona spotlights, risks with the simulated posts behind them, recommendations, limitations, and a post index. It makes no external requests and works offline.

**Viewing on GitHub:** GitHub displays this file as source rather than rendering it. Use **Raw → Download raw file**, then open the downloaded `report-1.html` locally.

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
npm test               # 66 unit + golden tests (byte-identical replay, citation integrity)
npm run test:e2e       # 2 end-to-end: real SDK client ↔ server over stdio
npm run cleanroom      # zero-egress gate: no network APIs, no URLs, no key surfaces
npm run build          # rebuild dist from source (all 5 packages)
```

Replay the demo (rewrites `murmur-demo/.murmur/` deterministically — same seed,
same bytes, every time; needs the `npm install` above first):

```bash
node tools/demo-live.mjs
```

The scripts in `tools/` resolve `murmur/` and `murmur-demo/` relative to their
own location, so the bundle can sit anywhere on disk. `scale-benchmark.mjs`
measures token budget and wall time at any scale:
`node tools/scale-benchmark.mjs 48 8`.

## Publishing to npm (when you're ready)

1. `repository` / `homepage` / `bugs` in
   `murmur/packages/server/package.json` already point at
   `github.com/Ratz00007/murmur-mcp` — create the repo at that path, or update
   those three fields plus the badge URLs at the top of this README.
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
Reproduce with `node tools/scale-benchmark.mjs <personas> <rounds>`.

**Measured engine-side budget per full run** (deterministic mock brain, so these
are content-independent: they measure the task payloads the host must read and
the shape of what it must write — *not* how verbose a real model is):

| scale | generation items | input tasks | output content | round trip | engine wall time |
|---|---|---|---|---|---|
| defaults 24 × 8 | 80 | ≈ 57.8k | ≈ 6.5k | **≈ 64.3k** | 1.41s |
| flagship 48 × 8 | 160 | ≈ 85.4k | ≈ 10.9k | **≈ 96.3k** | 2.98s |

Input splits roughly: ontology ≈0.8k, personas ≈1.0k, per-round sim batches
≈7.9k–9.8k each, report task ≈5.0k. Output splits ≈ generations (9.3k at
flagship) + report draft (≈1.6k). Report markdown ≈26k chars either way.

**Measured from the bundled mock demo** (`murmur-demo/.murmur/` — mock brain,
12 personas · 5 rounds, a smaller run than the defaults above):

| Artifact | Measured | ≈ tokens (chars/4) |
|---|---|---|
| Report output `report-1.md` | 26,320 chars | ≈ 6.6k output |
| Round-1 generation batch prompt (reported in `DEMO-TRANSCRIPT.md`) | ≈ 932 tokens | as reported |
| Largest single host response, budget 12,000 (reported in `DEMO-TRANSCRIPT.md`) | 4,645 tokens | as reported |
| `audit.jsonl` / `interviews.jsonl` / `qa.jsonl` | 28 / 1 / 1 records (3,265 / 433 / 339 B) | ≈ 0.8k / 0.1k / 0.1k |

Real-LLM cost varies by model, provider pricing and prompt caching. The tables
above are char-based estimates from deterministic runs — treat them as a
**ceiling on task payload size**, not a bill. A run also costs your session's
wall-clock time (the engine is 3s; the LLM round-trips are the slow part).
Pending: median billed tokens/report from the first real-LLM gallery run —
publish it in `gallery/` and replace this line with the measured figure.

## Where to read more

- [`ANALYSIS-AND-ROADMAP.md`](ANALYSIS-AND-ROADMAP.md) — the blunt review that
  produced this codebase, the phase plan, its status, and the agreed guardrails
- [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md) — what is left before launch,
  in order (repo, npm, real-LLM flagship run, directories)
- [`gallery/`](gallery/README.md) — published runs (real ones and clearly
  labeled mock measurements)
- [`murmur-demo/FLAGSHIP-DEMO.md`](murmur-demo/FLAGSHIP-DEMO.md) — the 48 × 8
  real-LLM protocol and its results table
- [`murmur/GOOD-FIRST-ISSUES.md`](murmur/GOOD-FIRST-ISSUES.md) — ten scoped
  starter tasks for contributors
- [`PROJECT-WORKLOG.md`](PROJECT-WORKLOG.md) — the full build journal (design
  decisions, test counts, what was cut and why)

| Topic | File |
|---|---|
| Project journal (how it was built) | `PROJECT-WORKLOG.md` |
| Original PRD + technical plan (24 pp) | `murmur/docs/Murmur-PRD-Technical-Plan-v1.0.pdf` |
| Install matrix, guarantees, layout | `murmur/README.md` |
| Release notes | `murmur/CHANGELOG.md` + `murmur/packages/server/CHANGELOG.md` |
| Clean-room + zero-key policies | `murmur/CONTRIBUTING.md` |
| Security / injection hardening | `murmur/SECURITY.md` |
| License | `murmur/LICENSE` (Apache-2.0) + `murmur/NOTICE` |
