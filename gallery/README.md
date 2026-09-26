# Murmur gallery — real runs only (except the labeled mock demo)

Each entry is a complete, verbatim run: the client transcript, the report
(Markdown + self-contained HTML), and a header stating exactly what produced it.

Entry header (every entry MUST include):

- client + version (e.g. Claude Code 1.4.2)
- model (e.g. claude-opus-4-6) — or **MOCK** if no host LLM was used
- personas / rounds / platforms / seed / ensemble runCount
- tokens in/out — **billed** for a real run (provider's own usage readout);
  `chars/4` estimate only on rows explicitly labeled MOCK
- wall-clock time
- "what we would change" — one honest paragraph about the report's weaknesses

`_TEMPLATE/` carries the contributor checklist. See `INDEX.md` for entries.

## What is in here right now

- **2 MOCK rows** — the bundled demo and the 48 × 8 scale benchmark. These
  exercise the engine end to end with a deterministic mock brain. They prove the
  plumbing. They prove nothing about content quality, and they say so.
- **1 headless, LLM-authored row** — `host-llm-run-01/`. Real model-written
  personas and posts, but driven by `tools/host-llm-run/run.mjs`: no client
  session, no agent transcript, no billed tokens. Useful and honest, and still
  not the demonstration.
- **1 PENDING row** — the flagship real-LLM run (16 personas × 8 rounds). Not
  run yet. It has no numbers, because a projected number in a results table is a
  fabricated number.

So: **no real client-session run has been published.** That is the gallery's one
open credibility gap, and it is small — one run, one real pricing page, one
sitting.

## Rules

- **Label the brain.** MOCK or real, in the entry header and in `INDEX.md`. No
  unlabeled rows, ever.
- **Real seed material, declared.** Say whether the seeds were a real pricing /
  launch page, fictional worked-example content, or a mix. The bundled Acme
  Cloud files in `murmur-demo/examples/` are fictional.
- **Verbatim or nothing.** Ship the transcript unedited, rejections and retries
  included. A trimmed transcript is a press release.
- **Billed, not estimated.** A real run's token count comes from the provider's
  usage readout. If you don't have one, write `not available`.
- **Publish it even if it's unflattering.** A bland report, a persona that talks
  like a press release, a verdict you disagree with — those ship, with a "what we
  would change" note. Re-rolling seeds until you like the answer turns evidence
  into marketing.

## Entry directory

```
flagship-<client>-<model>/
├── README.md        <- filled from _TEMPLATE/CHECKLIST.md
├── transcript.md    <- verbatim, unedited
├── report-1.md
├── report-1.html
└── artifacts/       <- optional: audit.jsonl, graph.mmd, timeline
```
