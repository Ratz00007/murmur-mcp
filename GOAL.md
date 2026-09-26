# GOAL — Murmur Phase 0 + Phase 1: Ship, Prove, and De-risk (15-Agent Execution)

**Objective**
Use a 15-agent team to implement the approved Phase 0 + Phase 1 expert-panel plan
for the Murmur project at `C:\Users\ratin\Desktop\murmur-mcp`, and do all of it.
ICP for every decision: **a founder/dev about to ship a pricing or launch change.**
Repo goes **public**.

*Supersedes the previous goal "Murmur Category-Leadership Implementation (Phases 0–3)",
which reached `Status: complete (code + repo + plumbing) / blocked (external)` and whose
only remaining external items were the GitHub push (done 2026-09-23) and the npm/real-LLM
items that this goal now owns.*

**Success criteria** (derived from the approved plan, since the user did not restate them):

## Phase 0 — Lock the perimeter
- [x] `seed_add_files` jailed to workspace root; paths logged, not just counted
- [x] Root `.gitignore` ignores `.murmur/` (and the demo SQLite state)
- [x] Root `LICENSE` present (Apache-2.0, matching `murmur/LICENSE`)
- [x] Repo URLs unified to `Ratz00007/murmur-mcp` everywhere (incl. `packages/server/README.md`)
- [x] Release workflow hardened: actions SHA-pinned, tag guard on publish, `permissions:` blocks
- [x] `murmur/.git.bundle-history/` secret-scanned and reported — 0 secrets, 0 unique history (safe to delete, needs user approval)
- [x] Repo visibility set to **public**
- [ ] `murmur-mcp` npm name claimed — **BLOCKED on user** (`npm login`)

## Phase 1 — Truth & proof
- [x] Root README landing rebuilt for the founder-shipping-a-change ICP (276 → ~100 lines)
- [x] Doc lies fixed: test counts unified to 66, `init --write` truth stated, "2 minutes" claim
      removed, zip-vs-repo fiction dropped, phantom-path claims corrected
- [x] Claims-policy sweep: report retitled "Reaction Simulation Report", every rendered report
      now carries "simulated perspective, not a validated forecast", no "analyst-grade"/"predict"
- [x] `murmur-demo/.murmur/` regenerated with current code
- [x] Templates tiered: `launch` + `crisis` primary, policy/finance/fiction marked secondary
- [x] `SECURITY.md` false claim removed; real gate scope + threat model + install-time TOFU documented
- [x] Flagship protocol resized to 16 personas × 8 rounds + gallery scaffold ready
- [x] Full verification green: `npm test` 66/66 · `npm run test:e2e` 2/2 · `npm run cleanroom` GATE GREEN · typecheck exit 0

**Status:** active — code work complete; two items need the user (below)

## Blocked on the user (cannot be done from here)
1. **`npm login` + publish** — the `murmur-mcp` name is still unclaimed, so every `npx` install
   instruction in the docs points at a name anyone can squat. Repo is now public, so provenance
   will work. Runbook: `murmur/packages/server/PUBLISH-CHECKLIST.md`.
2. **The real-LLM flagship run** — 16×8 in a real client session per `murmur-demo/FLAGSHIP-DEMO.md`.
   A real-client smoke probe already passed (`tools/flagship-16x8/probe.log`: `STATUS=ok`, all 29
   tools exposed, world created), so the server works end-to-end in a live agent; the full run
   needs the operator's own LLM session.

**Progress log**
- 2026-09-23 — Goal set. 8-expert panel audited the repo; scores were PMF 3/10, MCP-readiness
  6/10, scientific credibility 4/10, launch readiness 2/10. User approved: public repo,
  Phase 0 + Phase 1 scope, founder-shipping-a-change ICP. Replacing prior goal (was complete).
- 2026-09-26 — 15-agent team executed in 3 waves (Sentinel, Keeper, Cartographer, Blacksmith,
  Advocate, Archivist, Piper, Scribe, Voice, Curator, Broker, Stagehand, Beacon, Ledger + main
  agent). All Phase 0/1 code work landed and verified.
- CAUGHT 3 real defects the agents introduced or left behind:
  (1) Sentinel's workspace-jail helper was defined but NEVER CALLED — wired it in myself.
  (2) `tools/demo-live.mjs` did `rmSync(murmur-demo/)`, wiping tracked FLAGSHIP-DEMO.md and
      flagship.config.json on every documented "replay the demo" run — narrowed to `.murmur/`.
  (3) `node_modules/@murmur/*` junctions pointed at a deleted path (`murmur-complete-v1.0.0`),
      so local builds had been silently broken; CI masked it via fresh `npm ci`. Repaired.
- VERIFIED: build exit 0 · 66/66 unit+golden · 2/2 e2e · typecheck exit 0 · cleanroom GATE GREEN.
- Repo pushed and set to PUBLIC; CI green on the public repo. Description retargeted to the ICP.
