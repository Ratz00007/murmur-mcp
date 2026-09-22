# Murmur

**Social-simulation for coding agents. Predict how communities react — powered by the coding subscription you already pay for.**

Murmur is an [MCP](https://modelcontextprotocol.io) server that runs agent-based social simulations: seed it with your material (a pricing page, a policy memo, an incident brief), and a population of simulated users debates it across Twitter-style and Reddit-style platforms. You get a versioned, in-repo prediction report — trajectory, named risks with cited posts, confidence — plus the ability to interview any simulated persona about why they wrote what they wrote.

**Zero API keys. Zero extra bills.** The engine is deterministic and LLM-free; every generation is performed by *your* coding agent's LLM (Claude, Codex, Gemini, Antigravity, OpenCode, Hermes…) through the connection you already have. The server makes **no outbound network calls at all** — enforced by a release-gate test that fails the build on any egress, key or token surface.

```
You:            /murmur-predict How will r/programming react to the new pricing page?

Your agent:     world_init → seed_add_files → ontology_plan → ontology_submit
                → graph_build → personas_plan → personas_submit
                → [sim_next_batch → sim_submit_generations] × 8 rounds
                → report_plan → report_submit → report_export

Result:         .murmur/reports/pricing-reaction/report-1.md
                (Mermaid sentiment charts, 3 cited risks, post index, diffable)
```

---

## Why

Tools like MiroFish solve social simulation with a server-side LLM: you pay a monthly plan, supply an API key, and your data goes through their cloud. Murmur flips the architecture — **Host-Powered Inference**:

| | Key-requiring SaaS | Murmur |
|---|---|---|
| LLM calls | Their API key, your bill | Your coding agent, on your existing subscription |
| Memory | Cloud memory service, quota | Three-tier local memory in SQLite, in your repo |
| Artifacts | Web console | Markdown + Mermaid files in `.murmur/`, render on any git forge |
| Reproducibility | Best-effort | Deterministic engine: same seed + same submissions ⇒ byte-identical world |
| Where it runs | Their servers | Your machine, one stdio process, zero egress |

The engine (world state, ontology graph, persona activation, feed ranking, retweet amplification, vote gravity, virality, sentiment, stance migration, escalation detection, statistics) is pure, deterministic computation. The intelligence — writing posts in character, drafting the report narrative, answering interviews — is borrowed from the host agent in batched plan/submit exchanges, so one tool call amortizes many generations.

## Install

One command per client (Node ≥ 20):

| Client | Install |
|---|---|
| **Claude Code** | `claude mcp add murmur -- npx -y murmur-mcp` |
| **Codex CLI** | `codex mcp add murmur -- npx -y murmur-mcp` |
| **Gemini CLI** | `gemini mcp add murmur -- npx -y murmur-mcp` |
| **Cursor** | `cursor mcp add murmur -- npx -y murmur-mcp` |
| **Antigravity** | `mcpServers` JSON in your agent config: `{"murmur":{"command":"npx","args":["-y","murmur-mcp"]}}` |
| **OpenCode** | `opencode.json` → same `mcpServers` entry |
| **Hermes** | your Hermes MCP config → same `mcpServers` entry |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` → same entry |
| **Cline / Continue** | `cline_mcp_settings.json` / `~/.continue/config.yaml` → same entry |
| **VS Code Copilot** | `.vscode/mcp.json` → same entry |

Every snippet is also printed by `npx murmur-mcp doctor` (which also checks Node, the SQLite native module and your workspace) and `npx murmur-mcp init --client <id>`.

> Installing from source (before the first `npm publish`): `npm i -g ./murmur-mcp-1.0.0.tgz` then use `murmur-mcp` as the command (or point `command` at `node …/packages/server/dist/index.js`).

## Quickstart (2 minutes, no keys)

1. Install for your client (above).
2. Put some material in your repo — a pricing page export, a FAQ, a changelog, or run `npx murmur-mcp init --template launch` for a fill-in brief.
3. In your coding agent:

```
/murmur-predict How will developers react to our new pricing? Sources: pricing-page.md, FAQ.md
```

That's it. The prompt is a playbook: your agent drives all 29 tools in order, shows you digests for approval, writes the report, and every receipt tells it the next step. Mid-run experimentation:

```
/murmur-simulate How will r/programming react to the pricing change? Rounds: 4
  … agent pauses, shows you the sentiment timeline …
  You: inject "competitor undercuts us by 30%" and continue
/murmur-interview Ask @ada why she's so hostile about the migration guide
/murmur-resume pricing-reaction
```

## What you get

- **`.murmur/murmur.db`** — the whole world in SQLite (10 tables: worlds, seeds, entities, relations, personas, memories, posts, events, reports, generations). Portable by copying the directory; resumable at any stage boundary after a crash.
- **`.murmur/{world}/graph.mmd`** — the ontology graph as Mermaid (typed relations: alliance / opposition / influence / ownership, with tension scores).
- **`.murmur/reports/{world}/report-N.md`** — versioned prediction reports: Mermaid `xychart` sentiment curves, stance-migration bars, escalation chains, persona leaderboards, deterministic statistics appendix and a post index. Reports regenerate, never mutate — diff two scenarios line by line.
- **`.murmur/{world}/interviews.jsonl` + `qa.jsonl`** — logged deep-interaction dialogues.
- **`.murmur/{world}/audit.jsonl`** — the audit trail of every plan/submit exchange.

## How it works

**The five-stage pipeline** (full parity with the category, reimagined for agents):

1. **Seeds** — attach files (PDF/MD/TXT/CSV/JSON), URLs (your agent fetches, the engine never does), or pasted text. Byte-hashed dedupe.
2. **Ontology** — `ontology_plan` composes an extraction task (seed digests + strict JSON schema); your agent's LLM extracts entities, motives and factual anchors; `ontology_submit` validates item-by-item with surgical retry.
3. **Graph** — deterministic derivation of typed relations and tensions; reddit-style communities; stance-affinity follow graph; Mermaid export.
4. **Population** — archetype distribution derived from the ontology; Big-Five-lite traits; per-entity stances; platform mix; audit and edit individuals before the run.
5. **Simulation** — each round the engine activates a weighted persona subset and composes personalized digests (persona card ≤ 120 tokens, ranked feed, working memory, collective view); your LLM writes their posts/replies/votes; the engine ingests, runs platform mechanics (feed ranking, retweet amplification, vote gravity, virality thresholds), organic engagement, three-tier memory with compaction, stance migration and sentiment tracking. Inject god's-eye events between rounds and watch the trajectory move.
6. **Report + interaction** — deterministic stats + evidence pack in, narrative out, versioned report to disk; then interview any persona (grounded in its own memory and posts — it declines knowledge it never saw) or interrogate the whole run with cited answers.

**Context-budget engineering** is an engine contract, not a hope: persona cards are capped, feeds are ranked-and-truncated per persona, memory compacts between rounds, no tool response exceeds 12,000 tokens (oversize payloads spill to disk with fetch-by-id receipts), and batch sizes adapt via `world_config`.

**Determinism**: content ids are count-based, all randomness flows from the world seed through named streams, and phases 2–5 of every round are pure functions of stored state. Golden-run tests replay recorded sessions and assert byte-identical outcomes.

## Tool catalog (29 tools)

| Group | Tools |
|---|---|
| World | `world_init` `world_list` `world_open` `world_status` `world_config` |
| Seeds | `seed_add_files` `seed_add_url` `seed_add_text` `seeds_review` |
| Ontology | `ontology_plan` `ontology_submit` |
| Graph | `graph_build` `graph_query` `graph_export_mermaid` |
| Personas | `personas_plan` `personas_submit` `persona_inspect` `persona_edit` |
| Simulation | `sim_configure` `sim_next_batch` `sim_submit_generations` `sim_inject_event` `sim_round_summary` `sim_timeline` |
| Report | `report_plan` `report_submit` `report_export` |
| Interaction | `interview_agent` `report_agent_ask` |

Prompts (one-command playbooks): `murmur-predict`, `murmur-simulate`, `murmur-interview`, `murmur-resume`. Resources: `murmur://worlds`, `murmur://world/{id}/state`, `murmur://world/{id}/report/{rid}`.

## Configuration

```jsonc
// defaults (tune via world_config / sim_configure)
{
  "rounds": 8,                                  // 1–40
  "batch":  { "maxPersonas": 20, "maxFeedItems": 8, "personaCardTokens": 120 },
  "context": { "maxResponseTokens": 12000 },
  "engagement": { "viralityThreshold": 12, "organicCapPerPost": 0.6 },
  "memory": { "episodicMaxRecords": 40 }
}
```

Environment: `MURMUR_WORKSPACE` (override the workspace root; default: git repo root), `MURMUR_LOG` (stderr log level; stdout is protocol-only).

## Guarantees (tested, not promised)

- **No API key, ever** — no key or token field exists in any config surface; the cleanroom gate statically fails the release on egress APIs, URLs, or key patterns in the shipped bundle, and audits the dependency closure for network libraries.
- **Client neutrality** — the server contains zero client-specific branches; per-client differences live in `packages/adapters` as snippets and templates.
- **Resumability** — every tool is safe to re-issue after a crash; sessions resume to the exact stage boundary.
- **Performance** — the full pipeline (seeds → report) runs headless in ~0.1 s on the reference corpus; a 24-persona, 8-round world completes in a single agent session.

## Repository layout

```
packages/
  engine/      deterministic simulation core (pure TS + SQLite adapter)
  server/      the murmur-mcp npm package: 29 tools, resources, prompts, CLI
  prompts/     playbook prompt packs
  adapters/    per-client install snippets + config templates (10 clients)
  templates/   scenario packs: launch, policy, crisis, finance, fiction
tests/
  golden/      byte-identical replay tests + pipeline acceptance (F1–F7)
  integration/ real MCP client ↔ server e2e over stdio
  cleanroom/   the release gate (no-egress, no-key, deps, timing, isolation)
examples/      a ready-to-run demo scenario + paste-ready prompts
```

Develop: `npm install && npm run build && npm test` (42 tests) · `npm run test:e2e` · `npm run cleanroom` · `npm run demo` (headless full pipeline, no LLM needed).

## License & provenance

Apache-2.0. Murmur is a clean-room implementation: no code, prompts or configuration from any AGPL-licensed project were copied (see `CONTRIBUTING.md` for the policy that binds every contribution). "MiroFish" is a third-party trademark used only in factual comparisons.
