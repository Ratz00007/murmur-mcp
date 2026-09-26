# Murmur run index

| run | client | model | personas | rounds | tokens | report |
|---|---|---|---|---|---|---|
| `murmur-demo/` (bundled) | deterministic mock — **MOCK, not a product run** | n/a (mock) | 12 | 5 | n/a | `murmur-demo/.murmur/reports/pricing-reaction/report-1.html` |
| `scale-benchmark-48x8/` | headless `tools/scale-benchmark.mjs` — **MOCK, engine measurement only** | n/a (mock) | 48 | 8 | ≈96.3k est. round trip | no report published (content quality not measured) |
| `host-llm-run-01/` | headless `tools/host-llm-run/run.mjs` — **LLM-AUTHORED run, real content, not a client-IDE session** | Claude (this agent) | 12 | 4 | n/a (offline authoring) | [`report.html`](host-llm-run-01/report.html) · [`report.md`](host-llm-run-01/report.md) |
| `flagship-*` | _pending client-IDE run (Claude Code / Codex / Gemini CLI)_ — see `murmur-demo/FLAGSHIP-DEMO.md` | _pending_ | 48 | 8 | — | — |

## What "LLM-authored" means, precisely

`host-llm-run-01` is **real LLM content through the real engine**, and it is
**not** the same thing as a client-IDE flagship run. Read the difference before
you cite it:

| | `host-llm-run-01` (this) | `flagship-*` (pending) |
|---|---|---|
| Persona voices / post text | **Real LLM-authored** — written by a language model from each persona card, not template strings | Real LLM-authored |
| Engine, validators, storage, report | **Identical** — no code path bypassed, schema violations are rejected exactly as in a real client | Identical |
| Transport | Headless driver (`tools/host-llm-run/run.mjs`) replaying the MCP tool sequence | Live MCP stdio session inside a coding agent |
| Reproducibility | Engine deterministic; **content bytes not replayable from seed** (the LLM is the non-deterministic input) | Same |
| Scale | 12 personas × 4 rounds (19 posts) — chosen to be completable and auditable, not impressive | 48 personas × 8 rounds |

So this run **closes the "the demo is mocked" gap** — the content is genuinely
model-written, the mock-brain templates are not involved anywhere in it. It does
**not** close the "no client-IDE transcript exists yet" gap.

## Verify this run yourself

```bash
cd murmur
npm install && npm run build
cd ..
node tools/host-llm-run/run.mjs init
node tools/host-llm-run/run.mjs submit 1     # then author brain/round-1.json, repeat to 4
node tools/host-llm-run/run.mjs report
node tools/host-llm-run/verify-citations.mjs .murmur/murmur.db .murmur/reports/acme-pricing-reaction/report-1.md
```

Result of the citation check on the published run: **20 posts in db
(`po_1`..`po_20`), 19 distinct post ids cited in the report, 0 dangling —
citation integrity 100%.**

