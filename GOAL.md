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
- [ ] `seed_add_files` jailed to workspace root; paths logged, not just counted
- [ ] Root `.gitignore` ignores `.murmur/`
- [ ] Root `LICENSE` present (Apache-2.0, matching `murmur/LICENSE`)
- [ ] Repo URLs unified to `Ratz00007/murmur-mcp` everywhere (incl. `packages/server/README.md`)
- [ ] Release workflow hardened: actions SHA-pinned, tag guard on publish, `permissions:` blocks
- [ ] `murmur/.git.bundle-history/` secret-scanned and reported (deletion needs user approval)
- [ ] Repo visibility set to **public**
- [ ] `murmur-mcp` npm name claimed (blocked on user's `npm login` if no token available)

## Phase 1 — Truth & proof
- [ ] Root README first ~40 lines rebuilt: one-liner for the founder moment, dashboard hero,
      3-click demo path, exactly ONE install command that works today, ≤100-line landing target
- [ ] All doc lies fixed: test counts (66), phantom `murmur-complete-v1.0.0/` path,
      `init --write` promise, "2 minutes" claim, zip-vs-repo fiction, dead badges
- [ ] Claims-policy sweep: no "forecast"/"predict"/"analyst-grade" in shipped report or README
- [ ] `murmur-demo/.murmur/` regenerated with current code (kills stale-fixture contradiction)
- [ ] Templates cut to launch + crisis (finance/fiction/policy de-emphasized)
- [ ] `SECURITY.md` false claim removed; honest trust model documented
- [ ] Flagship protocol resized to 12–16 personas × 8 rounds + gallery scaffold ready
- [ ] Full verification green: `npm test`, `npm run test:e2e`, `npm run cleanroom`, typecheck

**Status:** active

**Progress log**
- 2026-09-23 — Goal set. 8-expert panel audited the repo; scores were PMF 3/10, MCP-readiness
  6/10, scientific credibility 4/10, launch readiness 2/10. User approved: public repo,
  Phase 0 + Phase 1 scope, founder-shipping-a-change ICP. Replacing prior goal (was complete).
