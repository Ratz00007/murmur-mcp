# Security Policy

Murmur is a local-only scenario simulation server that speaks MCP over stdio. This document describes what the code actually does, not what we wish it did. Where a control is partial, we say so.

## Threat model

Murmur assumes it is **trusted** and that its host is **honest**. Specifically:

- **It is a trusted local process, not a sandbox.** Murmur runs as a stdio MCP server inside a process you launched, inheriting your full environment, filesystem permissions and credentials. It has no isolation of its own. Anything it can read, it can read; anything your user account can do, it can do. Do not run it as root, and do not point it at a workspace you are not willing to expose.
- **The workspace jail is per-tool.** `seed_add` (source `'files'`) is the only tool that reads arbitrary paths; it enforces a workspace boundary — both the literal path and the nearest-existing-ancestor real path are checked, so `../` escapes, absolute paths outside the root, and symlinks pointing out are all refused with an error (verified by the e2e jail and symlink tests). Other tools operate on data already inside `.murmur/`. `MURMUR_WORKSPACE` sets the root the jail runs against.
- **Tool responses leave your machine.** Seed text, feed text, event text and memory text are returned to whichever MCP client you connect — in practice a third-party LLM provider. Material you attach is disclosed to that provider under its own terms. Do not attach material you are not permitted to share.
- **Install-time egress exists (trust on first use).** `better-sqlite3` declares an install script (`prebuild-install || node-gyp rebuild --release`, `package-lock.json:1246`) that downloads a prebuilt native binary from GitHub Releases. The fetch path goes through `prebuild-install@7.1.3`, which npm marks **deprecated and unmaintained** (`package-lock.json:2660`) and which itself depends on network libraries (`simple-get`, `tunnel-agent`). This is the one place Murmur reaches the network, it happens at `npm install` rather than at runtime, and the binary is trusted on first use rather than signature-verified by Murmur. Use `npm ci` with a lockfile you have reviewed, and prefer a source build if that trade-off is unacceptable to you.
- **Untrusted content is data, but it is still data you chose to attach.** See "Prompt-injection hardening" for what is and is not enforced.

## What the release gate actually checks

`tests/cleanroom/gate.mjs` is a regression tripwire, not proof of incapability. Its honest scope:

- **Static scans cover the bundle, its sourcemap, and the engine source tree.** The no-egress read matches `packages/server/dist/index.js`, `index.js.map`, and every `.ts` file under `packages/engine/src` against a fixed list of regexes — `node:http`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `https?://`, and seven key/token patterns. An unlisted API, an obfuscated token, or a file outside those surfaces would not be caught.
- **Obfuscation is scanned for.** The gate also fails on `String.fromCharCode(<literal code points>)` calls and on string join-assembly that composes fragments of `fetch`, `https`, `Bearer`, `Authorization`, `api.`, or `.com` anywhere in the scanned surfaces — the techniques previously used to hide live network code from the static scan.
- **A dynamic no-egress probe executes the engine's discourse adapters.** A subprocess stubs `globalThis.fetch` to record every call and throw, imports the built engine, and drives each adapter's `fetchThread` under the former tier-2/tier-3 option shapes. The probe passes only if `fetch` is never invoked. This catches egress that static regexes cannot see; it covers the four adapters, not the whole server process.
- **The three runtime dependencies are never scanned.** The MCP SDK, `better-sqlite3` and `zod` are external to the bundle the gate reads; the gate asserts their names are exactly the expected three and walks their transitive closure against the lockfile allowlist, but never inspects their contents.
- **The runtime checks are a smoke test.** The remaining checks time a headless five-tool pipeline under 120s, confirm a report file was produced, and walk the temp workspace for files outside `.murmur/`. The isolation walk covers only what that one pipeline wrote.

A green gate therefore means "the checks we wrote still pass", not "Murmur cannot egress". The first-party claims below rest on source review of `packages/*/src`, which is a stronger basis than the gate.

## Design-level guarantees

Scoped to first-party code paths in `packages/*/src`:

- **No runtime network calls.** Murmur's own code imports no `node:http`, `node:https`, `node:net`, `node:dns` or `node:tls`, and calls no `fetch`, `XMLHttpRequest` or `WebSocket`. The four discourse adapters (reddit, hackernews, twitter, github) are offline-fixture-only: `fetchThread` always returns a local fixture and reads no secrets. No outbound URLs exist in the shipped code or engine source. `seed_add_url` records a URL as provenance only; the engine never fetches it — the client fetches the page and passes the text in.
- **No API keys, tokens or accounts in any configuration surface.** Murmur requires no credentials to run. It reads no environment secrets and defines no key or token fields. (Third-party dependencies are outside this claim — see the threat model.)
- **State stays under `.murmur/` in your workspace** (SQLite plus Markdown/JSONL artifacts). This is a statement about where Murmur *writes*; the `seed_add` read boundary is enforced separately (workspace jail, above).

## Prompt-injection hardening

Seed material is untrusted input, and Murmur never lets it act as an engine directive. Every generation task embeds seed, feed, event and memory text inside explicit delimiters with a data notice, and the engine only ever stores submitted fields as content. Two honest limits on this:

- **No instruction-like content filtering exists.** Submission validation does not attempt to detect or reject instruction-shaped text. `validateReportDraft` (`packages/engine/src/report.ts:231-310`) checks only string minimum lengths, enum membership for `severity` and `likelihood`, minimum array counts for findings, risks, recommendations and confidence signals, a 2–3 post-id range per risk, and that each cited post id actually exists in storage. Text that passes those checks is stored verbatim, however it reads. The protection is structural — delimiters, a data notice, and content-only storage — not lexical.
- **Your client is the enforcement point.** Because tool output flows to an LLM, the practical defence against injected instructions is the client that renders it, plus the discipline of reviewing what you attach. Do not rely on Murmur to filter it.

### Known gaps

- **No known first-party filesystem escape.** The `seed_add` workspace jail (previously an open, documented release blocker) is now enforced and covered by e2e tests for both `../`/absolute escapes and symlinked parents. The remaining exposure is the threat-model one: Murmur runs with your full user permissions, so anything the process itself can read *through a legitimate workspace path* is in scope — attach only what you are willing to share with your MCP client's provider.

## Reporting a vulnerability

Open a private security advisory (GitHub → Security → Advisories) or email the maintainers. Please include reproduction steps and affected versions. We aim to respond within 72 hours.
