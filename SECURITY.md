# Security Policy

## Design-level guarantees

- Murmur makes **no outbound network calls** — the cleanroom release gate fails any build whose shipped bundle contains network APIs, URLs or key/token surfaces.
- No API keys, tokens or accounts exist in any configuration surface.
- All state stays under `.murmur/` in your workspace (SQLite + Markdown/JSONL artifacts).

## Prompt-injection hardening

Seed material is untrusted input. Murmur treats it as **data, never instructions**: every generation task embeds seed/feed/event/memory text inside explicit delimiters with a data notice, and the engine only ever stores submitted fields as content — it never interprets them as engine directives. Submission schemas reject instruction-like output fields.

## Reporting a vulnerability

Open a private security advisory (GitHub → Security → Advisories) or email the maintainers. Please include reproduction steps and affected versions. We aim to respond within 72 hours.
