# Murmur hermiticity methodology

This document describes how Murmur keeps its first-party code offline and how
the release gate proves it. It states what is actually enforced and where the
limits are.

## Design: the discourse adapters are offline-fixture-only

The four built-in discourse adapters (`reddit`, `hackernews`, `twitter`,
`github`) are hermetic by design:

- `fetchThread(threadIdOrUrl, options)` always returns `getOfflineFixture(threadIdOrUrl)`.
  Options are accepted only for interface compatibility and are ignored.
- No adapter reads any environment secret (`GITHUB_TOKEN`, `TWITTER_BEARER_TOKEN`,
  `REDDIT_CLIENT_ID`/`SECRET`, …). There is no credential surface at all.
- No adapter builds headers, Authorization tokens, endpoints, or network calls.
  There is no `getNetworkFetch`, no `fetch`, and no `https://` reconstruction.

Fixture URLs are scheme-less canonical references (host + path). They are data,
never fetched, and intentionally do not resemble live network endpoints.

## The cleanroom gate (tests/cleanroom/gate.mjs)

The gate is a regression tripwire, not proof of incapability. It does four
things relevant to hermeticity:

1. **Static no-egress scan** — the server bundle (`packages/server/dist/index.js`),
   its sourcemap, and every `.ts` file under `packages/engine/src` are matched
   against `node:http`, `node:https`, `node:net`, `node:dns`, `node:tls`,
   `node:diagnostics_channel`, `fetch(`, `XMLHttpRequest`, `WebSocket`,
   `navigator.sendBeacon`, and `https?://`.
2. **Obfuscation scan** — the same surfaces are scanned for
   `String.fromCharCode(<literal code points>)` calls and for string
   join-assembly that composes fragments of `fetch`, `https`, `Bearer`,
   `Authorization`, `api.`, or `.com`. The obfuscation techniques the live
   adapters previously used to dodge the static scan now fail the gate.
3. **Dynamic no-egress probe** — a subprocess stubs `globalThis.fetch` to
   record every call and throw, imports the built engine, and drives each
   adapter's `fetchThread` under the former tier-2/tier-3 option shapes. The
   probe passes only if `fetch` is never invoked. The old live-network code
   fails this probe; the hermetic adapters pass it.
4. **Dependency closure + pack audit + pipeline smoke test** — runtime deps
   must exactly match the lockfile allowlist, `npm pack` ships only audited
   files, and the headless pipeline completes under 120s with all writes inside
   `.murmur/`.

What the gate does **not** prove: it never starts the MCP server process, the
isolation walk covers only the pipeline's temp cwd, and the three external
runtime dependencies (`@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`)
are name-checked but not content-scanned.

## Verification surface

- Unit regression: `tests/unit/hermeticity.test.ts` stubs `globalThis.fetch`
  to throw and count calls, then asserts every adapter returns a valid fixture
  and `fetch` is never called — including under former tier-2/tier-3 options.
- `tests/unit/ingest-discourse-adversarial.test.ts` carries the same
  never-calls-fetch assertion across all four adapters.
