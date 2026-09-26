# PUBLISH CHECKLIST — `murmur-mcp` (npm)

`murmur-mcp` is **unclaimed** — `npm view murmur-mcp` returns 404. Every
`npx -y murmur-mcp` instruction in the docs points at a name anyone can squat.
Claim it first; treat this as the hard blocker.

Work top to bottom. Steps 1–3 are the blockers; step 4 is the proof.

---

## 0. Preferred path — let CI publish (RECOMMENDED)

`.github/workflows/release.yml` runs the cleanroom gate + tests and publishes
with provenance off a GitHub release. **Use this.**

```bash
git tag v1.0.0
git push origin v1.0.0        # -> GitHub release -> npm publish --provenance
```

Manual publish (steps 1–4 below) **forfeits that guarantee** — provenance
becomes a locally-signed attestation instead of a GitHub OIDC-attested one.
Ship the artifact through the workflow unless there is a real reason not to.

## 1. Repo must be PUBLIC (BLOCKER)

Provenance is issued against a public GitHub repo. While the repo is private,
`npm publish --provenance` fails outright.

- [ ] Repo visibility set to **Public** on github.com/Ratz00007/murmur-mcp
- [ ] `package.json` → `repository` / `homepage` / `bugs` point at the public repo
- [ ] CI green on GitHub (`.github/workflows/ci.yml`)

## 2. Claim the name

```bash
cd murmur/packages/server
npm login                 # or set an NPM_TOKEN repo secret and use the workflow
```

## 3. Inspect the tarball BEFORE publishing (BLOCKER)

Never publish blind — the name is permanent and a version number cannot be
reused.

```bash
npm pack --dry-run
```

Read the file list. Expected: `dist/`, `README.md`, `LICENSE`, `NOTICE`,
`CHANGELOG.md`, `package.json`. Nothing else.

- [ ] No `src/`, no `*.ts`, no `.env`, no fixtures, no local scratch DBs
- [ ] `dist/index.js.map` **is present** — see note below before you accept it
- [ ] `package.json` description + keywords match what you expect

## 4. Publish

```bash
npm publish --access public --provenance
```

## 5. Verify (PROOF)

```bash
npm view murmur-mcp            # 1.0.0 must resolve, NOT 404
npx -y murmur-mcp doctor       # on a clean machine
```

- [ ] `npm view murmur-mcp` resolves
- [ ] `npx -y murmur-mcp doctor` works
- [ ] README Option A no longer says "not published yet" (two places)
- [ ] `npm view murmur-mcp dist.provenance` shows an attestation

---

## Note — `dist/index.js.map` ships in the tarball

`tsup.config.ts` sets `sourcemap: true`, and `files` includes `dist`. The map
is ~650 KB and carries `sourcesContent` for **all 48 bundled workspace files**
(~420 KB of original TypeScript: engine `src/`, store, ingest, ontology,
prompts). It is included in the published artifact and has never been audited.

It is a clean-room-sensitive repo (see `NOTICE`). Recommendation, in order of
preference — **not applied here**, this runbook only reports it:

1. Turn `sourcemap` off for the published build (cheapest, kills the leak).
2. Keep maps but drop `sourcesContent`, so no first-party TS is published.
3. Keep as-is, and accept that full first-party source becomes public at
   publish time — decide that deliberately, not by accident.

## Claims policy (unchanged)

Use: "simulated perspective", "evidence-cited", "reproducible", "zero-key".
Banned as product claims: "predict", "forecast", "analyst-grade", "#1",
"best". Never keyword-stuff a competitor's trademark.
