# Murmur gallery — real runs only (except the labeled mock demo)

Each entry is a complete, verbatim run: the client transcript, the report
(Markdown + self-contained HTML), and a header stating exactly what produced it.

Entry header (every entry MUST include):

- client + version (e.g. Claude Code 1.4.2)
- model (e.g. claude-opus-4-6) — or **MOCK** if no host LLM was used
- personas / rounds / platforms / seed / ensemble runCount
- tokens in/out (chars/4 estimator, same as the NFR in `murmur/tests`)
- wall-clock time
- "what we would change" — one honest paragraph about the report's weaknesses

`_TEMPLATE/` carries the contributor checklist. See `INDEX.md` for entries.
