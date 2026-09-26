# Security Policy

Murmur is a local-only scenario simulation server that speaks MCP over stdio. This document describes what the code actually does, not what we wish it did. Where a control is partial, we say so.

## Threat model

Murmur assumes it is **trusted** and that its host is **honest**. Specifically:

- **It is a trusted local process, not a sandbox.** Murmur runs as a stdio MCP server inside a process you launched, inheriting your full environment, filesystem permissions and credentials. It has no isolation of its own. Anything it can read, it can read; anything your user account can do, it can do. Do not run it as root, and do not point it at a workspace you are not willing to expose.
- **The workspace jail is per-tool and currently narrow.** `seed_add_files` is the only tool that reads arbitrary paths, and it does **not** currently enforce a workspace boundary — absolute paths anywhere on the filesystem are read and ingested as seed material (see "Known gaps"). Other tools operate on data already inside `.murmur/`. `MURMUR_WORKSPACE` sets the root but is not a security boundary.
- **Tool responses leave your machine.** Seed text, feed text, event text and memory text are returned to whichever MCP client you connect — in practice a third-party LLM provider. Material you attach is disclosed to that provider under its own terms. Do not attach material you are not permitted to share.
- **Install-time egress exists (trust on first use).** `better-sqlite3` declares an install script (`prebuild-install || node-gyp rebuild --release`, `package-lock.json:1246`) that downloads a prebuilt native binary from GitHub Releases. The fetch path goes through `prebuild-install@7.1.3`, which npm marks **deprecated and unmaintained** (`package-lock.json:2660`) and which itself depends on network libraries (`simple-get`, `tunnel-agent`). This is the one place Murmur reaches the network, it happens at `npm install` rather than at runtime, and the binary is trusted on first use rather than signature-verified by Murmur. Use `npm ci` with a lockfile you have reviewed, and prefer a source build if that trade-off is unacceptable to you.
- **Untrusted content is data, but it is still data you chose to attach.** See "Prompt-injection hardening" for what is and is not enforced.

## What the release gate actually checks

`tests/cleanroom/gate.mjs` is a regression tripwire, not proof of incapability. Its honest scope:

- **One file is scanned for code patterns.** The no-egress and no-key checks read exactly one artifact, `packages/server/dist/index.js` (`gate.mjs:38-56`), and match it against a fixed list of regexes — `node:http`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `https?://`, and seven key/token patterns. Anything that reaches the network through an unlisted API, an obfuscated token, or a file the gate does not read will not be caught.
- **The three runtime dependencies are never scanned.** The MCP SDK, `better-sqlite3` and `zod` are marked `external` in `packages/server/tsup.config.ts:14`, so they are absent from the bundle the gate reads. The gate asserts their *names* are exactly the expected three (`gate.mjs:61-63`); it never inspects their contents.
- **The dependency audit is a ~13-name denylist, expanded one level deep.** `NETWORK_DEP_DENYLIST` (`gate.mjs:28-31`) lists 13 package names, and closure expansion reads only the direct dependencies of the three top-level runtime deps (`gate.mjs:65-73`). The gate will report `✓ dependency closure has no network libraries` while the very same output line lists a closure containing `express`, `hono`, `cors`, `jose`, `undici`-adjacent transitives and others. Treat that line as "none of these 13 specific names appeared at depth 1", nothing more.
- **The runtime checks are a smoke test.** The remaining checks time a headless five-tool pipeline under 120s, confirm a report file was produced, and walk the temp workspace for files outside `.murmur/` (`gate.mjs:77-109`). The isolation walk covers only what that one pipeline wrote; it is not a general audit of where Murmur reads or writes.

A green gate therefore means "the checks we wrote still pass", not "Murmur cannot egress". The first-party claims below rest on source review of `packages/*/src`, which is a stronger basis than the gate.

## Design-level guarantees

Scoped to first-party code paths in `packages/*/src`:

- **No runtime network calls.** Murmur's own code imports no `node:http`, `node:https`, `node:net`, `node:dns` or `node:tls`, and calls no `fetch`, `XMLHttpRequest` or `WebSocket`. It contains no outbound URLs. `seed_add_url` records a URL as provenance only; the engine never fetches it — the client fetches the page and passes the text in.
- **No API keys, tokens or accounts in any configuration surface.** Murmur requires no credentials to run. It reads no environment secrets and defines no key or token fields. (Third-party dependencies are outside this claim — see the threat model.)
- **State stays under `.murmur/` in your workspace** (SQLite plus Markdown/JSONL artifacts). This is a statement about where Murmur *writes*; the `seed_add_files` read boundary is a separate and weaker matter, below.

## Prompt-injection hardening

Seed material is untrusted input, and Murmur never lets it act as an engine directive. Every generation task embeds seed, feed, event and memory text inside explicit delimiters with a data notice, and the engine only ever stores submitted fields as content. Two honest limits on this:

- **No instruction-like content filtering exists.** Submission validation does not attempt to detect or reject instruction-shaped text. `validateReportDraft` (`packages/engine/src/report.ts:231-310`) checks only string minimum lengths, enum membership for `severity` and `likelihood`, minimum array counts for findings, risks, recommendations and confidence signals, a 2–3 post-id range per risk, and that each cited post id actually exists in storage. Text that passes those checks is stored verbatim, however it reads. The protection is structural — delimiters, a data notice, and content-only storage — not lexical.
- **Your client is the enforcement point.** Because tool output flows to an LLM, the practical defence against injected instructions is the client that renders it, plus the discipline of reviewing what you attach. Do not rely on Murmur to filter it.

### Known gaps

- **`seed_add_files` does not enforce a workspace jail.** A containment check (`assertInsideWorkspace`, `packages/server/src/tools/seeds.ts:13-18`) is defined but never invoked; the handler resolves absolute paths as given (`seeds.ts:35`). This has been confirmed by running the built server against a canary file outside the workspace root: the tool returned `ok: true` for a path reported as `..\OUTSIDE_SECRET.txt` and persisted the file's contents into the world database. Treat every file the process can read as reachable by this tool, and do not attach untrusted MCP clients to a sensitive workspace. The fix is a one-line call and should be treated as a release blocker.

## Reporting a vulnerability

Open a private security advisory (GitHub → Security → Advisories) or email the maintainers. Please include reproduction steps and affected versions. We aim to respond within 72 hours.
