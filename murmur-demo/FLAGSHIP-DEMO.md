# FLAGSHIP DEMO — status: PENDING first real-LLM run (16 personas × 8 rounds)

The gallery's credibility blocker in one sentence: **every published row is MOCK or
pending, so nobody has ever seen what a real model produces through this pipeline.**

This run closes it. One real pricing page. **16 personas × 8 rounds**, both
platforms, one injection at round 4, one real host LLM, published verbatim.

> ### The rule that matters most
> **Publish it even if the report is unflattering.** A wrong verdict, a bland
> report, a persona that talks like a press release — those ship. The moment you
> start re-rolling seeds because you don't like the output, the run stops being
> evidence and becomes marketing. One honest mediocre run beats one curated good run.
>
> No mock LLM. No edited transcript. No estimate in a field that says "measured".

Machine-readable config: [`flagship.config.json`](flagship.config.json).

---

## 0 · The run card

| field | value |
|---|---|
| scenario | `launch` — reaction to a pricing / launch change |
| personas | **16** (mix: free users, Pro users, indie devs, open-source maintainers, press voices, rival fans, cautious observers) |
| rounds | **8** |
| platforms | both (reddit + twitter across the population) |
| injection | round 4: *"StackHaven announces a free-tier match plus a one-click importer"* |
| ensemble runCount | 5 |
| client | Claude Code / Codex CLI / Gemini CLI — record the exact version |
| model | record the exact model id |
| output | `gallery/flagship-<client>-<model>/` |

**Why 16 and not 48.** The 48 × 8 shape is already published as a labeled MOCK
engine measurement ([`gallery/scale-benchmark-48x8/`](../gallery/scale-benchmark-48x8/)),
so the marginal credibility of re-running it is small. A finished real-LLM run is
worth more than an ambitious one that never happens. 16 personas × 8 rounds is
small enough to complete in one sitting and large enough for factions, platform
divergence and a round-4 shock to actually show up in the report. 48 × 8 is
[§7 — stretch goal](#7--stretch-goal-48--8-optional-later).

---

## 1 · Before you start (5 minutes)

```bash
# 1. the server is healthy
npx -y murmur-mcp doctor

# 2. keep this run's .murmur/ OUT of the repo root, so it never mixes with the
#    mock demo in murmur-demo/.murmur/  (that one stays mock, forever)
mkdir -p flagship-run
#    then start your client with MURMUR_WORKSPACE=<abs path>/flagship-run
```

If you skip `MURMUR_WORKSPACE`, the world is written to `.murmur/` at the git repo
root and your flagship artifacts sit next to unrelated runs. Set it.

**Pick your seed material and be honest about which it is.** The ICP is a founder
or dev about to ship a pricing or launch change, so the strongest flagship uses
their *own* material:

- **Real (preferred):** the pricing or launch page you are actually shipping, or a
  real public pricing page. Fetch it yourself, then hand the extracted text to
  `seed_add_url` with the live URL as the reference.
- **Fictional (fallback):** [`examples/pricing-page.md`](examples/pricing-page.md),
  [`examples/FAQ.md`](examples/FAQ.md), [`examples/CHANGELOG.md`](examples/CHANGELOG.md).
  This is invented Acme Cloud worked-example content. Fine to run, but the entry
  header **must** say the seeds were fictional.
- **Mixed** is allowed. Blending real and fictional without saying so is not.

Write down which one you chose now, so the header is honest later:
`real / fictional / mixed → ______`

---

## 2 · Start the run — paste this verbatim

The client exposes the playbooks as MCP prompts. This is the whole pipeline in
one paste:

```
/murmur-predict How will developers and press react to our new pricing page?
Sources: <your real pricing URL, or: murmur-demo/examples/pricing-page.md, examples/FAQ.md, examples/CHANGELOG.md>

Hard requirements for this run — these override the playbook defaults:
- personas_plan MUST use count: 16 (playbook default is 24)
- sim_configure MUST use rounds: 8
- world name: flagship-16x8
- ensemble runCount: 5
- one injection at round 4 (I will tell you when)
```

> The `count: 16` and `rounds: 8` lines are load-bearing. The playbook says
> "default 24 personas" — if you don't override it, you are running 24 × 8 and
> your gallery row will be wrong.

Want to inspect the run mid-flight instead? Use `/murmur-simulate` with
`Rounds: 4`; it pauses after round 4 and offers the injection. Same run.

---

## 3 · The exact tool sequence (if you drive it by hand)

Copy this table into your notes. Every receipt tells you the next step; follow
the receipts, not this table, if they disagree.

| # | tool | args |
|---|---|---|
| 1 | `world_init` | `name: "flagship-16x8"` |
| 2 | `seed_add_url` *or* `seed_add_files` *or* `seed_add_text` | your pricing material (§1) |
| 3 | `seeds_review` | — (show the digest) |
| 4 | `ontology_plan` → `ontology_submit` | entities, relations, tensions. Fix only the rejected items, resubmit the same `task_id`. |
| 5 | `graph_build` → `graph_export_mermaid` | note relation count + top tensions |
| 6 | `personas_plan` | **`count: 16`**, `hint: "span reddit and twitter"` |
| 7 | `personas_submit` | 16 personas; then `persona_inspect` on 2–3 to sanity-check voice |
| 8 | `sim_configure` | **`rounds: 8`** |
| 9 | rounds 1–3 | `sim_next_batch` → author every activated persona's actions (max 3 each) → `sim_submit_generations` |
| 10 | **the injection** | see §4 |
| 11 | rounds 4–8 | same loop as step 9 |
| 12 | `report_plan` → `report_submit` | exactly 3 risks, each citing real post ids |
| 13 | `report_export` | **`format: "both"`** (writes `report-1.md` + `report-1.html`) |
| 14 | `sim_timeline` + `sim_round_summary` | for the timeline table in the entry README |

Rejected items are **not** a failure — they are the validator working. Fix them
surgically and resubmit the same `task_id`. Do not pass `finalize: true` unless the
operator explicitly asks for it.

---

## 4 · The round-4 injection (the interesting part)

Fire it **after round 3 is submitted**, so the event lands in the round 4 digest
and personas react to it in the same round they read about it.

Tool call:

```json
{
  "text": "StackHaven announces a free-tier match plus a one-click importer",
  "round": 4,
  "type": "price",
  "scope": "all"
}
```

Or, mid-conversation, just say:

```
Inject this event now: "StackHaven announces a free-tier match plus a one-click importer"
It must land in round 4, scope all.
```

Notes that will save you a failed run:

- `round` is clamped to *at least* `current round + 1` — call it too early and it
  silently lands in round 4 anyway.
- It **refuses after the final round**. If you inject after round 8, you must
  `sim_configure({ rounds: N })` to extend first, and that changes the run.
- Inject **once**. Two injections is a different experiment; label it as one.
- Save the receipt's `eventId` and `landsInRound` — quote them in the entry README
  so a reader can find the injection in `audit.jsonl`.

After round 4, ask for the diff so the injection's effect is visible rather than
asserted: `sim_round_summary({ round: 4 })` and `{ round: 5 }`, side by side.

---

## 5 · Interrogate it (10 minutes, high value)

One grounded follow-up, from `murmur-interview`:

```
/murmur-interview Ask the most hostile persona why the migration path reads as a paywall
```

```
/murmur-interview Ask the ReportAgent: which three posts carry the biggest risk, and what is the weakest link in your own evidence?
```

The second question is the one to paste into the transcript. If the ReportAgent
cannot name its weakest link, write that down too.

---

## 6 · Capture — exactly what goes in `gallery/flagship-<client>-<model>/`

Create the directory, then copy artifacts in **unedited**:

```
gallery/flagship-<client>-<model>/
├── README.md          <- from ../_TEMPLATE/CHECKLIST.md, filled in honestly
├── transcript.md      <- VERBATIM. Include the rejections and the retries.
├── report-1.md        <- from .murmur/reports/<world-slug>/report-1.md
├── report-1.html      <- from .murmur/reports/<world-slug>/report-1.html
└── artifacts/         <- optional but cheap
    ├── audit.jsonl    <- every plan/submit exchange, incl. the injection receipt
    ├── graph.mmd
    └── timeline.txt   <- sim_timeline + sim_round_summary output
```

### Billed tokens — measured, never estimated

Get the number from the **provider's own usage readout** for the session (the
`usage` / token-count line in the client, or the provider dashboard). Record:

```
billed tokens in  : ______   (source: provider usage readout)
billed tokens out : ______   (source: provider usage readout)
```

If you cannot get a billed number, write `not available` and say so in the entry.
Do **not** substitute the chars/4 estimator — that is fine for the labeled MOCK
benchmark table, and wrong here, because this row is supposed to be the real one.

### Then, before you call it done

1. Fill in `gallery/flagship-<client>-<model>/README.md` using
   [`../_TEMPLATE/CHECKLIST.md`](../_TEMPLATE/CHECKLIST.md) — every box.
2. Add the row to [`../gallery/INDEX.md`](../gallery/INDEX.md) and change the
   `flagship-*` row from *pending* to the measured values.
3. Update the results table in this file (§8).
4. Write the "what we would change" paragraph. One paragraph. Honest. Include the
   parts that embarrass you.

---

## 7 · Stretch goal: 48 × 8 (optional, later)

Only after a 16 × 8 real-LLM run is published. Then, and only then, re-run the
same protocol at `personas_plan { count: 48 }` and publish it as
`gallery/flagship-<client>-<model>-48x8/`. Budget roughly 3× the 16 × 8 generation
items; the engine-side cost envelope is already published as
[`gallery/scale-benchmark-48x8/`](../gallery/scale-benchmark-48x8/) (MOCK, engine
measurement only). The stretch goal is about *content* at scale, not about the
number in the table.

---

## 8 · Results

One row per published flagship. **Empty cells stay empty until a real run fills
them.** No projections, no mock numbers, no "expected ≈".

| client | model | personas | rounds | seed | billed tokens in/out | wall time | report | published |
|---|---|---|---|---|---|---|---|---|
| _pending_ | _pending_ | 16 | 8 | — | — | — | — | — |

---

## 9 · Alternative path: `tools/host-llm-run/run.mjs` (not the flagship)

`tools/host-llm-run/run.mjs` is a headless driver that runs the **same MCP tool
sequence** against the **real engine and real validators**, with content authored
into `tools/host-llm-run/brain/` instead of by a live agent. Schema-violating
content is rejected exactly as it would be in Claude Code. Useful for rehearsing
the sequence or regenerating a stage.

**What it is not:** it is not a client-IDE session. There is no host LLM in the
loop, no agent transcript, and no billed token count — the "LLM" is a human
authoring JSON. So:

- ✅ fine for rehearsal, for debugging a stage, for producing report artifacts
- ❌ **not** publishable as the flagship, and **not** a substitute for §1–§6

If you use it, the gallery labels it *"headless driver, LLM-authored content, no
client session"*. Do not let it fill the §8 row.

---

## 10 · Failure modes, and what they mean for publishing

| symptom | what it actually means | do this |
|---|---|---|
| the agent drifts to 24 personas | playbook default won | re-run from `personas_plan`, or publish 24 and say 24 |
| injection lands in the wrong round | clamped to `current + 1` | quote the receipt; disclose the actual round |
| `sim_submit_generations` rejects items | validator doing its job | fix surgically, keep the rejects in the transcript |
| report cites a post id that doesn't exist | `report_submit` should have blocked it | don't publish a hand-patched report |
| the verdict is wrong or bland | **the most likely outcome** | publish it, add "what we would change" |

The mock demo ([`murmur-demo/`](.)) is **not** the flagship and stays labeled
mock-driven, forever.
