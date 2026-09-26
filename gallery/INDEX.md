# Murmur run index

Every row states, in the same words, **what actually produced it**. Rows marked
**MOCK** used the deterministic mock brain: they measure the engine, not the
product. Rows marked **PENDING** have not happened yet — they carry no numbers,
because a projected number in a results table is a fabricated number.

| run | client | model | personas | rounds | tokens | report |
|---|---|---|---|---|---|---|
| `murmur-demo/` (bundled) | deterministic mock — **MOCK, not a product run** | n/a (mock) | 12 | 5 | n/a | `murmur-demo/.murmur/reports/pricing-reaction/report-1.html` |
| `scale-benchmark-48x8/` | headless `tools/scale-benchmark.mjs` — **MOCK, engine measurement only** | n/a (mock) | 48 | 8 | ≈96.3k est. round trip | no report published (content quality not measured) |
| `host-llm-run-01/` | headless `tools/host-llm-run/run.mjs` — **LLM-authored content, NOT a client-IDE session**: no agent transcript, no host LLM in the loop, no billed count | n/a (no model billed) | 12 | 4 | not recorded (no provider usage to bill) | `host-llm-run-01/report.html` |
| `flagship-*` | **PENDING — first real-LLM run, not yet run.** Protocol: [`murmur-demo/FLAGSHIP-DEMO.md`](../murmur-demo/FLAGSHIP-DEMO.md) | _pending_ | **16** (target) | 8 | _pending — will be a billed count, not an estimate_ | _pending — `gallery/flagship-<client>-<model>/report-1.html` when it exists_ |

## The pending row, in plain words

**No real client-session run of Murmur has ever been published.** Two rows above
are MOCK, one (`host-llm-run-01/`) is LLM-authored content driven headlessly
rather than by an agent in Claude Code / Codex / Gemini — honest, and still not
the demonstration. This pending row is the only blocker between this gallery and
a real one, and the plan is deliberately small enough to finish:

- **16 personas × 8 rounds**, both platforms, one injection at round 4
- **one real pricing page** as the seed material (fictional worked-example seeds
  are acceptable, but the entry must say which)
- one real host LLM in a real client session (Claude Code / Codex CLI / Gemini CLI)
- capture: verbatim transcript, `report-1.md`, `report-1.html`, **billed** token count

Why 16 × 8 and not 48 × 8: the 48 × 8 shape is already covered above as a
labeled MOCK engine measurement, and a finished real run is worth more than an
ambitious one that never happens. 48 × 8 remains available as a later stretch
goal — see §7 of the protocol.

## When a run lands here

Add one new row per published run and leave the PENDING row in place until the
directory exists. Fill in only measured values: exact client + version, exact
model id, personas, rounds, seed, ensemble `runCount`, billed tokens, wall time,
and a report path that resolves. Then tick
[`_TEMPLATE/CHECKLIST.md`](_TEMPLATE/CHECKLIST.md).

**Publish it even if the verdict is unflattering.** That is the entire point of
the pending row.
