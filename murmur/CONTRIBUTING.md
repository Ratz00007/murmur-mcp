# Contributing to Murmur

Thanks for helping build the zero-key social-simulation engine. Two policies matter more here than in most projects — read them first.

## 1. Clean-room policy (binding)

Murmur implements the *concept* of agent-based social simulation as a clean-room work. Some category predecessors (e.g. MiroFish) are AGPL-3.0. To keep Murmur permissively licensed (Apache-2.0) and embeddable anywhere:

- **Never** copy code, prompts, configuration, comments or documentation from an AGPL-licensed project into this repository — not even "as a reference".
- If you have worked with such a codebase, say so in your PR description. Substantive design decisions should cite public workflow *descriptions*, not implementation internals.
- Workflow concepts (five-stage pipelines, persona simulation, dual platforms, reports) are fine to reimplement; their *expression* is not.
- CI greps the tree against known AGPL source strings as a tripwire. A hit blocks the release.
- The project name and marketing never use third-party trademarks except in factual comparisons.

## 2. The zero-key contract (binding)

The product promise is that Murmur runs entirely on the user's existing coding subscription. In practice:

- The engine and server make **no outbound network calls**. No `fetch`, `node:http(s)`, `net`, `dns`, `tls` — nothing.
- No API-key, token or account field may appear in any config surface, environment handling or prompt.
- The cleanroom gate (`npm run cleanroom`) statically enforces both rules against the shipped bundle and its dependency closure. If your PR adds a dependency, expect the gate to scrutinize it. Gate red = release blocked.

## Development

```bash
npm install
npm run build         # engine, prompts, adapters, templates, server bundle
npm test              # unit + golden (66 tests)
npm run test:e2e      # real MCP client <-> server over stdio + cleanroom gate
npm run demo          # headless full pipeline (mock brain, no LLM)
npm run typecheck
```

- **Engine changes** must keep the determinism contract: identical seeds + submissions replay byte-identically. Golden-run tests enforce it; if you change a persisted format intentionally, regenerate expectations and say so in the PR.
- **Tool changes** are semver-major surface changes (the tool catalog is the API).
- **New clients**: add an adapter in `packages/adapters` (snippet + template + detection) — never a client-specific branch in the server.
- **New scenario packs** belong in `packages/templates`.

## Good first tasks

New here? [`GOOD-FIRST-ISSUES.md`](./GOOD-FIRST-ISSUES.md) lists ten scoped
starter issues, each with file hints and acceptance criteria. Standard checks:
`npm install && npm test` (unit + golden), `npm run test:e2e`, `npm run cleanroom`.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Every PR runs the full CI matrix (Node 20/22/24, plus a Windows smoke job).
