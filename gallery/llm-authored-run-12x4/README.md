# LLM-authored run — Acme Cloud pricing reaction

**What this is:** a complete Murmur run where a **real language model** (not the
deterministic mock brain) authored every piece of content — the ontology, the 12
personas, all 4 rounds of posts, and the analyst narrative. The engine, the
validators, the statistics and the report rendering are the real production code
path, unchanged.

**How to read the label:** this is an *LLM-authored run*, not a client-IDE
session. It is stronger than the mock demo (real prose, real disagreement, real
validator pressure) and weaker than a run driven through Claude Code / Codex /
Gemini CLI. The distinction is stated in `tools/flagship-16x8/RUN-LOG.md`, which
also records why the client-IDE run could not complete on a free client model.

## The run

| | |
|---|---|
| World | `acme-pricing-reaction` |
| Seed | `host-llm-flagship-01` |
| Personas | 12 (authored, mixed stance: supporters, opponents, undecided) |
| Entities | 15 |
| Rounds | 4 |
| Posts | 20 |
| Engagement | 12 points |
| Citation integrity | **100%** — 19 distinct post ids cited, all resolve |

## What the run concluded

The headline finding is that the crowd did **not** escalate. Controversy scored
**16/100 (low-stakes)**, zero escalation chains formed, and momentum cooled
−29%. The decisive number was faction share, not sentiment: 1 supporter vs 4
opponents, with **7 of 12 personas (58%) still undecided**. That undecided bloc
carried more engagement than supporters and opponents combined, and the single
most-engaged post was not an attack on the pricing but a confused student asking
how to claim the amnesty form.

The reading: a documentation failure being mistaken for a pricing betrayal.

## Reproduce it

```bash
node run.mjs init          # validates the authored ontology + personas
node run.mjs submit 1      # ingest round 1, dump round 2's task
node run.mjs submit 2
node run.mjs submit 3
node run.mjs submit 4      # dumps the report evidence pack
node run.mjs report        # validate + store + render md + html
```

Then verify every citation resolves against the database:

```bash
node verify-citations.mjs <workspace>/.murmur/murmur.db <report-1.md>
```

Authored content lives in `brain/`. If a file violates the schema, the **real**
validator rejects it and the round is held — nothing is bypassed.

## Files

| File | What |
|---|---|
| `report-1.md` / `report-1.html` | the stored report, markdown + self-contained dashboard |
| `graph.mmd` | Mermaid entity graph |
| `run.mjs` | the headless driver (same tool sequence as MCP, no client needed) |
| `verify-citations.mjs` | standalone citation-integrity check |
| `brain/` | the authored seed, ontology, personas, 4 rounds, and report draft |

## Honest limitations

- 12 personas / 4 rounds is a small sample. The −29% momentum trend is well
  inside noise at this size and the report says so.
- Sentiment is attributed to entities by keyword, so several entity curves are
  sparse — Acme Cloud's −0.32 reading rests on only 2 direct mentions.
- The linear projection and the P10–P90 ensemble band both returned **null** for
  this run, so no forecast slope or interval is available. The report makes no
  forward-looking numeric claim rather than inventing one.
- No organic or cascade engagement fired in this run, so the seeded diffusion
  model was not exercised by authored content.
- Content was authored by an LLM, so the prose bytes are not replayable from the
  seed alone. Engine determinism is intact; LLM non-determinism is not.
