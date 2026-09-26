# Client-run flagship — attempt log (honest record)

Goal: a flagship run driven by a **real MCP client** (Claude Code CLI) acting as
the host LLM, to replace the mock-brain demo as the primary evidence.

Two prior attempts, both archived in this folder as raw transcripts.

## Attempt 1 — 26 tool calls, 0 usable results

| Symptom | Count |
|---|---|
| `world_init` called with **empty `{}` arguments** | 3 (plus a 4th retry) |
| Calls to a nonexistent tool literally named `tool` | several |
| Successful tool results (`"ok": true`) | 8 |
| Workspace created at `.murmur/.murmur/` (nested) | yes |

## Attempt 2 — after fixing config + protocol: 6 calls, 1 success

| Symptom | Count |
|---|---|
| `world_init` with empty `{}` again | 2 |
| `No such tool available: tool` | 2 |
| Blocked on permissions (`acceptEdits` does not cover MCP tools) | fixed with `--allowedTools "mcp__murmur__*"` |

## Root cause (not a Murmur bug)

The CLI resolves to **`deepseek-v4.1-flash:free`**, the only free model this
account can select. It cannot reliably populate MCP tool arguments — it emits
`{}` and then retries the identical call instead of reading the error. Paid
models (`--model sonnet|opus`) return `402 Your Token Harbor balance is at $0`.

This is a **client-model capability limit**, not an engine or server defect. The
same pipeline, same validators and same schemas were driven end-to-end by an
LLM-authored run (`tools/host-llm-run/`) which produced 20 posts, a stored
report and **100% citation integrity**.

## Real bugs this exercise DID surface (both fixed)

1. **`MURMUR_WORKSPACE` was documented ambiguously** — the help text said
   "override the workspace root", so pointing it at the `.murmur` directory
   itself silently produced a nested `.murmur/.murmur/`. Fixed in
   `packages/server/src/cli.ts`: the help now states it is the project root
   that *contains* `.murmur/`, and warns against pointing it there.
2. **The run protocol did not state argument shapes**, so a client could not
   know that `ontology_submit`/`personas_submit` take `result`,
   `report_submit` takes `draft`, and generations key the persona as `persona`
   (not `personaId`). Fixed in `RUN-PROTOCOL.md` with a literal JSON table.

## What a successful client run needs

A client model that reliably emits structured tool arguments — i.e. any paid
tier, or a local model served through a client that supports MCP argument
marshalling. Re-run with:

```powershell
claude -p --model <a model that fills tool args> `
  --output-format stream-json --verbose `
  --mcp-config mcp-config.json `
  --permission-mode acceptEdits --allowedTools "mcp__murmur__*" `
  --max-turns 60 < probe.md > transcript.jsonl
```
