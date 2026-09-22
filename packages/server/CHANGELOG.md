# Changelog

## 1.0.0 — 2026-09-23

First stable release.

- Analyst-grade prediction reports: faction analysis, persona arcs, attributed quote bank, controversy index, cross-platform divergence, momentum and trajectory projection, amplification and narrative timeline, risk register with early-warning triggers, and 5 evidence appendices.
- Sentence-level sentiment attribution toward the focus entity — praise for a competitor never leaks into the focus entity's score.
- Sentiment scorer v2: sentence-aware negation, community-slang safe ("no notes" stays praise, "never crashes" reads positive), expanded inflection lexicon.
- Release workflow: npm publish gated on the full test + cleanroom matrix, with provenance.

## 1.0.0-rc.1 — 2026-09-22

First release candidate: the complete five-stage pipeline, Host-Powered Inference, zero API keys.

- **Engine** (`@murmur/engine`): deterministic, LLM-free simulation core — seeded RNG streams, SQLite storage (10-table schema, WAL), seed ingestion with extractive digests and best-effort PDF text extraction (with host-fallback receipt), ontology plan/apply with itemized validation, typed-relation graph derivation with tension scores and Mermaid export, persona drafting/auditing/editing with ≤120-token persona cards, weighted persona activation, personalized feed composition (Twitter ranking with retweet amplification; Reddit vote gravity and thread previews), batch generation tasks with context-budget enforcement (≤12k tokens), itemized sim ingestion with sticky-hold surgical retry and finalize, deterministic organic engagement, virality/hot events, three-tier local memory (working/episodic/collective) with compaction, stance migration, escalation-chain detection, engagement peaks, leaderboards, sentiment curves, report stats packs and Markdown+Mermaid rendering, grounded interview and report-agent evidence packs.
- **Server** (`murmur-mcp`): 29 MCP tools, 3 resources, 4 prompt playbooks, stdio transport, stderr-only logging, sampling as an opt-in accelerator (`use_sampling`), CLI (`serve` default, `doctor`, `init`, `templates`, `version`).
- **Adapters** (`@murmur/adapters`): install snippets + config templates for the 10-client launch matrix, with detection.
- **Templates** (`@murmur/templates`): scenario packs — launch, policy, crisis, finance, fiction.
- **Tests**: 42 tests — unit (rng determinism, sentiment, PDF, storage roundtrips, platform mechanics, submit validation), golden runs (byte-identical replay, F1–F6 acceptance, injection-shift effect, crash resume), real MCP client↔server e2e over stdio, and the cleanroom release gate (no egress, no keys, clean dependency closure, time-to-first-world, workspace isolation).
