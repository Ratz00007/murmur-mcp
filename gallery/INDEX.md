# Murmur run index

Every row states, in the same words, **what actually produced it**. Rows marked
**MOCK** used the deterministic mock brain: they measure the engine, not the
product. Rows marked **PENDING** have not happened yet — they carry no numbers,
because a projected number in a results table is a fabricated number.

| run | client | model | personas | rounds | tokens | report |
|---|---|---|---|---|---|---|
| `murmur-demo/` (bundled) | deterministic mock — **MOCK, not a product run** | n/a (mock) | 12 | 5 | n/a | `murmur-demo/.murmur/reports/pricing-reaction/report-1.html` |
| `scale-benchmark-48x8/` | headless `tools/scale-benchmark.mjs` — **MOCK, engine measurement only** | n/a (mock) | 48 | 8 | ≈96.3k est. round trip | no report published (content quality not measured) |
| `llm-authored-run-12x4/` | headless `tools/host-llm-run/run.mjs` — **LLM-authored content, NOT a client-IDE session**: no agent transcript, no host LLM in the loop, no billed count. **Citation integrity 100%** (19/19 ids resolve). | n/a (no model billed) | 12 | 4 | not recorded (no provider usage to bill) | [`llm-authored-run-12x4/report-1.html`](llm-authored-run-12x4/report-1.html) |
| `flagship-16x8` | **PENDING — client-IDE run attempted and BLOCKED.** Attempts logged in [`tools/flagship-16x8/RUN-LOG.md`](../tools/flagship-16x8/RUN-LOG.md): the only free client model (`deepseek-v4.1-flash:free`) emits empty `{}` tool arguments and cannot drive the pipeline; paid models return 402. | _blocked_ | **16** (target) | 8 | _pending_ | _pending_ |

## The pending row, in plain words

**No real client-session run of Murmur has ever been published.** Two rows above
are MOCK, one (`llm-authored-run-12x4/`) is LLM-authored content driven
headlessly rather than by an agent in Claude Code / Codex / Gemini — honest, and
still not the demonstration. This pending row is the only blocker between this
gallery and a real one.

**This was attempted three times, and failed for a reason outside Murmur.**
The blocker is the *client model*, not the engine. **14 candidate models were
probed** (raw output: [`tools/flagship-16x8/model-probe.txt`](../tools/flagship-16x8/model-probe.txt)).
On this account the only model that responds at all is
`deepseek-v4.1-flash:free`, and it cannot reliably populate MCP tool arguments —
it emits `{}` and retries the identical call instead of reading the error.
`mimo-v2.6-flash:free` is `unrecognized_model`; the paid aliases (`sonnet`,
`opus`) return `402 Your Token Harbor balance is at $0`. The attempts did
surface two real Murmur defects, both fixed and documented — an ambiguous
`MURMUR_WORKSPACE` contract that silently nested `.murmur/.murmur/`, and a run
protocol that never stated argument shapes.

To close this row, re-run with any model that reliably emits structured tool
arguments (a paid tier, or a local model behind a client with MCP argument
marshalling):

```powershell
claude -p --model <model> --output-format stream-json --verbose `
  --mcp-config mcp-config.json --permission-mode acceptEdits `
  --allowedTools "mcp__murmur__*" --max-turns 60 < probe.md > transcript.jsonl
```

- **16 personas × 8 rounds**, both platforms, one injection at round 4
- **one real pricing page** as the seed material (fictional worked-example seeds
  are acceptable, but the entry must say which)
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
