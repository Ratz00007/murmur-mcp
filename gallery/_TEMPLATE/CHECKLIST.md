# Gallery entry checklist (copy into your entry's README)

Lead with honesty about *what produced this*. A reader who cannot tell MOCK from
real in the first three lines will assume the worst.

## 0 · Label it (do this first, before anything else)

- [ ] **MOCK or real?** stated in the first line — e.g. `real host LLM` or
      `MOCK (deterministic mock brain — measures the engine, not the content)`
- [ ] if real: **client + version** (e.g. `Claude Code 1.4.2`)
- [ ] if real: **exact model id** (e.g. `claude-opus-4-6`), not a family name
- [ ] if headless: say so — `tools/host-llm-run/run.mjs` is an LLM-authored
      headless driver with **no client session and no billed tokens**; it is not
      a substitute for a real client run

## 1 · The run card

- [ ] **personas** (target for the flagship: 16) and **rounds** (8) — the actual
      values used, not the ones you intended
- [ ] **both / one** platform, and which
- [ ] **seed** recorded verbatim (re-run it and you get a byte-identical world)
- [ ] **ensemble runCount** recorded (flagship uses 5)
- [ ] **injection**, if any: round + exact text + the receipt's `eventId`
      (flagship: round 4, "StackHaven announces a free-tier match plus a
      one-click importer")

## 2 · Seed material

- [ ] **real vs fictional vs mixed** — stated explicitly
- [ ] if real: the URL or file the material came from, and the date captured
- [ ] note that `murmur-demo/examples/` (Acme Cloud) is **fictional** worked-example
      content; never let it read as a real company's pricing page

## 3 · Cost

- [ ] **billed** tokens in/out from the provider's usage readout — not the
      chars/4 estimator (that is only acceptable on rows labeled MOCK)
- [ ] if no billed number is available: write `not available` and say why
- [ ] wall-clock time recorded

## 4 · Artifacts

- [ ] verbatim transcript attached — no trimming the ugly parts, rejections and
      retries included
- [ ] `report-1.md` attached
- [ ] `report-1.html` attached
- [ ] optional: `audit.jsonl`, `graph.mmd`, timeline, interview Q&A

## 5 · Honesty

- [ ] "what we would change" paragraph written honestly — at least one real
      weakness of the report, not a humblebrag
- [ ] no cherry-picked seeds; if the verdict looks wrong, it ships anyway
- [ ] nothing in the table is a projection, a mock number, or an estimate
      presented as measured
- [ ] row added to `INDEX.md`, and the PENDING row's status updated honestly
