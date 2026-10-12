# GOAL — Murmur: Reposition, Prove, and Harden to 20/10

**Objective**
Complete all remaining and pending work: reposition Murmur from "predicts your
audience's reaction" to "finds the objections that will kill the change, and
tells you which ones to test with a real human"; fix every real defect found in
audit; run a pre-registered benchmark against real observed reactions; and bring
engineering, protocol conformance, and launch readiness to the highest bar
achievable today.

**Status:** active — A, B, C, E1, E4, E5, E6, E7(surface), E8 complete. 267/267
unit+golden, 2/2 e2e, cleanroom GATE GREEN, lint/coverage/golden-hash gated in
CI, claim check GREEN at 267 tests and 11 tools. Next: D-arms pilot, E7-rest, F.

**Replaces:** the prior "Murmur Phase 0 + Phase 1: Ship, Prove, and De-risk"
goal. Two of its claims are **disproved by direct inspection** and are corrected
in the log below rather than carried forward:
- "Sentinel's workspace-jail helper was defined but NEVER CALLED — wired it in
  myself" — **it was never wired.** `assertInsideWorkspace` is defined at
  `murmur/packages/server/src/tools/seeds.ts:13` with **zero call sites** (verified
  by grep over the whole repo and by inspecting the built `dist/index.js`). The
  e2e test that "covers" it passes because the canary file does not exist, not
  because a jail works. `murmur/SECURITY.md:43` was the only accurate doc.
- "test counts unified to 66" — the real count is **69** unit+golden (measured,
  not read off a doc). Nine files say 66; `PROJECT-WORKLOG.md` says 42.

**Why reposition at all.** The original premise is empirically dead. Seshadri et
al., *"Lost in Simulation"* (ACL 2026) measures LLM-simulated users at ECE
15–20 points against real users, with results swinging 9pp by simulator model.
Chen et al., *"When Synthetic Users Fail"* (arXiv 2607.26348) finds no LLM beats
the best non-LLM baseline on real survey data. Meanwhile Socialtrait claims 86%
predictive accuracy with no method, Simile has raised $200M, and Reevemark ships
Sentinel. So a 20/10 Murmur cannot compete on predictive accuracy. It competes
on **published error rate, zero API keys, and a workflow that fits inside a
coding session** — by showing its work, including where it is bad.

---

## Success criteria

### A. Truth and safety — no real defects remain
- [x] A1 `assertInsideWorkspace` called from `seed_add_files`, using `realpath`
      so a symlink cannot escape; negative test creates a real file outside the
      root and asserts it is refused
- [x] A2 `createMessage` bound at `murmur/packages/server/src/server.ts:49`; the
      sampling accelerator is reachable; test proves it
- [x] A3 `patchPersona` and `deleteMemories` carry a `world_id` predicate
      (`murmur/packages/engine/src/store/storage.ts:421,487`) — today a `p_1`
      in two worlds is overwritten in both
- [x] A4 Zero hardcoded test counts in docs; a script generates them and CI
      fails on disagreement
- [x] A5 `*.db`, `*.db-wal`, `*.db-shm` gitignored
- [x] A6 The committed `murmur-demo/.murmur/` and `gallery/` reports match the
      code that generates them

### B. Credibility core
- [x] B1 `claim_verify` rejects a report draft containing a number not in the
      stats pack; negative-control test included
- [x] B2 Tautological or unreachable metrics, fixed or labelled
  - [x] B2a Virality was unreachable at the default config. **Fixed.**
  - [x] B2b `organicEngagementShare` rested on a 1–5 post denominator. **Now
        `null` below 10 organic reposts**, and every renderer says so
  - [x] B2c `polarization` now labelled as derived from the faction sizes
        printed beside it, with its formula
- [x] B3 `METHODOLOGY.md` written: personas are invented, the band is slope
      sensitivity not uncertainty, nothing is a measurement
- [x] B4 "ensemble" renamed to `sensitivity` in module, functions, config key,
      and ReportData field; semantics pinned by tests

### C. The Objection Dossier
- [x] C1 Objection Dossier: engine `dossier.ts` (task, validator, renderer),
      server `report({mode:'dossier'})` plan/submit/export, world-dir versioning
- [x] C2 Renderer keeps the self-contained offline properties (markdown; the
      HTML dashboard section follows the same pattern when added)

### D. MurmurBench
- [x] D1 Pair pipeline built and made honest. **Result: 1 verified pair, and the
      corpus cannot yield more** — see the finding below
- [ ] D2 Ground-truth objections extracted per the frozen rubric
- [ ] D3 Pre-emption rate control reported beside every recall figure
- [ ] D4 Arm A (naive baseline) and Arm B (full Murmur) run on the same blind inputs
- [ ] D5 **Kill criterion CANNOT be validly applied at N=1.** Recorded, with what
      resolving it would take. The product decision is therefore made on other
      grounds and this remains open.

### E. Engineering
- [x] E8 Tool count 29 → 11 with a CI assertion that the advertised count matches registration; duplicate `world_config`/`sim_configure` merged
- [x] E7 (protocol surface) outputSchema on all tools; deprecated ErrorCode replaced; tasks support advertised; resource-template completions
- [x] E2 (part) Dedicated tests: `report.ts` rules (report-draft.test.ts, 36), `analytics.ts`, `sim/ingest.ts`, `opinion.ts`
- [x] E3 (part) Server surface tests: tools.test.ts pins TOOL_COUNT, the migration map, output schemas, and live registration; server-cli.test.ts pins CLI routing, resolution, and the doctor matrix
- [x] E1 Coverage gated in CI at the measured floor (75/80/75/75); server-tools exclusion removed; lint runs on all three CI legs
- [x] E4 Biome error-gate + `noUnusedLocals`/`noUnusedParameters`; all seven `void x;` suppressions verified dead and removed, 12 further dead declarations surfaced and fixed
- [x] E5 Typecheck covers `tests/`, `prompts`, `adapters`, `templates`; 21 test type errors fixed, one API lie corrected (`insertEntities` demanded full `Entity[]` while minting the id itself)
- [x] E6 Cross-Node golden hash committed and checked on 20/22/24 × 3 OSes;
      every `localeCompare` in the deterministic path pins `"en"`
- [ ] E7 (rest) `elicitation`, `logging` over MCP — verify what the SDK exposes; document what is missing and why

### F. Launch
- [ ] F1 Docs reduced from ~3,500 lines to ~600; one README, one CHANGELOG, one METHODOLOGY, one BENCHMARK
- [ ] F2 README cites the two 2026 papers that say the old category does not work
- [ ] F3 MCP registry `server.json` + directory submission drafts
- [ ] F4 `murmur-diff`: re-run on an edited seed → line-level objection delta

### Blocked on the user
- `npm login` + publish — the `murmur-mcp` name is unclaimed. Runbook:
  `murmur/packages/server/PUBLISH-CHECKLIST.md`.
- Second person to score Arm A vs Arm B. At N=5 a single operator is tolerable
  only if the answer key is written before any arm output is seen; at N=20 it
  is not, and a second reviewer is required.

---

## Progress log

- 2026-09-23 — Prior goal set. 8-expert panel scored the repo PMF 3/10,
  MCP-readiness 6/10, scientific credibility 4/10, launch readiness 2/10.
- 2026-09-26 — 15-agent team completed Phase 0/1. Repo public, CI green.
- 2026-09-28 — **Brutal review.** 5.5/10 overall: engineering 8, honesty 9,
  scientific validity 2, differentiation 4, launch readiness 3. Root cause:
  the whole chain is an LLM writing fiction, scored by a ~200-word lexicon
  (`sentiment.ts:8`), shuffled by hardcoded Deffuant dynamics
  (`opinion.ts:53`). Nothing has ever been compared to a real human reaction.
  `calibrate/calibrate.ts:4-11` carries a 20-line warning about circular
  validation and **zero callers**.
- 2026-09-28 — **Four real defects confirmed by inspection**, none previously
  fixed: the unwired jail (A1), the detached `createMessage` (A2),
  cross-world `WHERE id=?` corruption (A3), and 0-of-29 `outputSchema` against
  `structuredContent` emitted on every response (`session.ts:85,92,109`).
- 2026-09-28 — **MurmurBench-0 sealed** at `bench/PROTOCOL.md` (commit `e700a3e`),
  with the kill criterion fixed in advance and amendments required to be visible.
- 2026-09-28 — Three protocol amendments, each recording what was observed before
  it: the mechanical filters could not express question-vs-announcement
  (`79045c2`); a verb test could not distinguish vendor from bystander, and
  bystanders are the population under test, so using them as ground truth is
  circular (`42ef5d5`); Reddit is dense with reactions and thin on announcements,
  so announcement and reaction must come from two different places (`7157960`).
  The third also declares a confound — prepared vendor announcements pre-empt
  their own objections — and a **pre-emption rate** control, with the arm
  *difference* named primary and absolute recall declared inflated.
- 2026-09-28 — Selection pipeline built and screens verified working. Four
  genuine pairs found: Hetzner price adjustment, Scaleway pricing update,
  ONLYOFFICE licence violation, Flathub licence compliance. Selection revised 11
  times; **stopped deliberately** rather than tuning to reach N=5, because
  continuing would be the exact post-hoc selection bias the seal exists to
  prevent. Next: find pairs by searching vendor *names* rather than searching for
  announcements, and/or move ground truth to GitHub issues and HN where the
  reaction thread and the announcement share a URL by construction.
- 2026-09-28 — **A1–A6 complete, each with a regression test proven to fail on
  the old code.** A1 the workspace jail was never wired; the e2e test that
  "covered" it passed because the canary file did not exist. Now called twice —
  literal resolution plus `realpathOfNearestExisting` for symlink escapes — and
  the test creates the canary, asserts the error text, adds a symlink case, and
  asserts the secret never reached the world. A2 `createMessage` was detached
  and called unbound, so every sampling call threw into a swallowed catch and
  `fillViaSampling` was unreachable while the capability probe reported success;
  bound, with a test that fails on the old code with the exact
  `_clientCapabilities` signature. A3 `patchPersona`/`deleteMemories` updated
  rows in every world holding the same id; now world-scoped, all five callers
  updated. Also fixed a latent id collision: `mintId` used `COUNT(*)`, which
  `compactIfNeeded`'s deletes could invalidate — now `MAX(n)`, which is
  byte-identical on the replay path and confirmed so by the golden test.
  A4 `tools/verify-claims.mjs` measures the suite and fails CI when a
  present-tense claim disagrees; it distinguishes current claims from dated
  records, so history is reported rather than rewritten. A5 SQLite state ignored
  everywhere. A6 the demo report said "seeded ensemble" while the code emitted
  "slope-jitter sensitivity" and CI stayed green; replayed.
- 2026-09-28 — **B1 complete: the engine now verifies every NUMBER in the
  report, not just post ids.** It previously instructed the model "never invent
  numbers" and enforced nothing, so any figure the model liked reached the
  dashboard. Two false-positive classes were found by running the verifier
  against the existing mock brain: persona handles (`@grace6` → the token `6`)
  and a character-class bug (`[@\/u]` matches a LITERAL `u`, which shredded
  "simulated" and swallowed every number after it). Both fixed, both pinned by
  tests, because a verifier that drops numbers is worse than none.
  VERIFIED: typecheck exit 0 · 83/83 unit+golden · 2/2 e2e · cleanroom GATE
  GREEN · claim check GREEN at 83 tests and 29 tools · golden byte-identical
  replay still passes.
- 2026-09-28 — **B2a found by measurement, and it is worse than the audit
  claimed. A viral post is structurally unreachable at the default config.**
  Measured over 10 seeded 5-round, 16-persona runs: **0/10 produced a single
  viral post**, max engagement observed 8 against a threshold of 12.

  Root cause, from the formulas rather than from reading them:
  `organicCapPerPost` puts a hard ceiling of `max(2, floor(eligible × 0.6))`
  engaged viewers on a post, each contributing at most 1 like or 2 for a
  repost. At the default population of 24 that is a ceiling of 17 against a
  threshold of 12 — so the threshold is reachable only if *every* eligible
  viewer engages, which has probability `0.48^23 ≈ 5e-8`. The expected
  engagement is about 4. A run cannot produce a viral post; it can only fail
  to.

  Consequences: `checkVirality` never fires, `analytics.amplification` always
  returns an empty `viralPosts`, report **Appendix C ("Amplification") always
  prints "no virality"**, the `viral posts` KPI is always 0, and the P50/engagement
  narrative in the mock brain and templates is describing events the engine
  cannot produce. This is a dead feature with a live-looking surface, which is
  worse than a missing one.

  The fix is NOT to lower the threshold until the probe passes — that would be
  tuning a number to make a test green. It is to make the threshold a function
  of the reachable ceiling: derive it from `cap` and the engagement
  distribution rather than hardcoding 12 against a scaled population. Until
  that is done, no claim about amplification may appear in the report.

  Correction to the earlier audit, recorded because it was wrong:
  `organicEngagementShare` is **not** structurally zero. The audit inferred it
  from `sim/ingest.ts:462` (organic rows are inserted with zeroed metrics),
  but organic reposts are later bumped by subsequent rounds, so the measured
  share was 0.05–0.10 on some runs. The real defect is different and subtler:
  the denominator is 1–5 posts, so the figure is noise presented as a
  percentage. Measure, then fix — do not reason from a formula and publish the
  inference.
- 2026-09-28 — **B2 and B3 complete. UNCOMMITTED — git.exe is missing from the
  machine** (no longer on PATH, `C:\Program Files\Git\bin` now holds only
  bash.exe). Work is verified on disk; it needs a commit once git is restored.

  B2a — the threshold was chosen by measurement, not by lowering a number until
  a test passed. Swept the per-round maximum engagement over 30 deterministic
  8-round, 24-persona runs (240 rounds, 1,497 posts): p50 4, p90 6, p95 7, p99 9,
  **max 11**. The old default of 12 sat above the maximum, so the event could
  not fire. A threshold of 8 lands at the ~96th percentile (3.8% of rounds) —
  rare, but real. The population/24 scaling was verified separately at 48
  personas, where base 8 behaves equivalently. `tests/golden/virality.test.ts`
  pins the *property* (a viral post occurs) rather than the constant, and was
  confirmed to fail on the old threshold with the exact "0 viral posts"
  signature, so a future retune of the engagement maths cannot silently re-break
  it.

  B2b — `organicEngagementShare` is now `number | null`, null below 10 organic
  reposts, with `organicPostCount` exposed so the report can say why. The
  replayed demo now reads "**not reported** — only 4 organic reposts occurred,
  too few for the ratio to be meaningful" where it previously printed a
  percentage off four posts.

  B2c — polarization is labelled in both renderers as derived from the faction
  sizes printed beside it, with its formula, so it cannot be read as an
  independent measurement.

  B3 — `METHODOLOGY.md` written at the repo root: what is real (determinism,
  no network, verified numbers, resolvable citations) versus what is not
  (invented personas, a ~200-term lexicon, a ±0.06 slope-jitter band presented
  as an interval, unfitted cascade and Deffuant parameters, `calibrate.ts`
  having no production caller). Cites the two 2026 papers by name.

  Also extended the B1 allowlist after the verifier correctly flagged two
  legitimate numbers: per-post sentiment and engagement (which the quote bank
  and post index already render) and the entity/persona counts (which the
  scenario recap states). A verifier that rejects a draft quoting only what the
  report itself displays is broken in the same direction as the old jail test.

  VERIFIED: typecheck exit 0 · 86/86 unit+golden (was 83, +3) · 2/2 e2e ·
  cleanroom GATE GREEN.
- 2026-09-28 — **git restored, B2/B3 committed, B4 done.** The Git install at
  `C:\Program Files\Git` had been partially wiped mid-session (`bin` held only
  bash.exe, `usr/bin` had a few MSYS tools, `cmd` was empty, `rg.exe` gone too).
  No package manager was available, so a PortableGit 2.51.0 was extracted to the
  temp dir and added to the user PATH. The system install is still broken and
  should be reinstalled properly; the portable copy is not a substitute long
  term because it lives in a temp directory.

  B4 — the P10–P90 band was relabelled in prose earlier while the code still
  said "ensemble" in the module name, every exported function, the config key
  and the ReportData field. Renamed throughout to `sensitivity`, and the module
  doc now states what the computation actually is: a least-squares fit whose
  slope is perturbed by ±0.06 across seeded refits, not a re-simulation and not
  an uncertainty interval.
  `tests/unit/sensitivity.test.ts` pins the semantics rather than the
  constants. The load-bearing assertion is that refits with different seeds
  agree **exactly** on every recorded round — if the mechanism were being
  resampled they would disagree there, so that is the available proof no
  re-simulation occurs. The jitter bound is checked against an independent
  least-squares fit, not against the implementation.

  VERIFIED: typecheck exit 0 · 91/91 unit+golden · 2/2 e2e · cleanroom GATE
  GREEN · claim check GREEN at 91 tests and 29 tools.
- 2026-09-28 — **E7/E8 landed with repairs, all verified before committing.**
  A prior session consolidated the 29-tool surface to 11 action-dispatched
  tools with outputSchema on every tool, a MIGRATED_TOOLS map for all 29 old
  names, assertToolSurface() failing at startup on drift, coverage configured,
  and E2/E3 test files — then was interrupted before verifying. Five failures
  on landing, each fixed rather than worked around:
  - The sim submit statsDigest schema demanded the FULL RoundStats shape while
    the receipt deliberately carries a TRIMMED digest. The schema now matches
    the digest, with a comment explaining why extending-then-requiring was the
    exact mismatch a strict client rejects.
  - The world_list status path spread the engine worldStatus (round as NUMBER)
    into a schema promising a STRING. Normalised to the row shape.
  - tools.test.ts asserted retired == 29 - TOOL_COUNT, which only holds if no
    old name survives. Four do, so retired is derived from the migration map.
  - The e2e drove the entire old surface; migrated call by call.
  - report-draft.test.ts assumed listWorlds()[1] is the newest world, but it
    orders created_at DESC. Rewritten to assert the same po_1 resolves to
    different rows in different worlds — what its comment actually claims.
  - adapters.test.ts asserted retired playbook names; updated to the new surface
    plus a tripwire that no playbook names any retired tool.
  VERIFIED: typecheck exit 0 · 255/255 unit+golden · 2/2 e2e · cleanroom GATE
  GREEN · claim check GREEN at 255 tests and 11 tools.
- 2026-09-28 — **E1/E4/E5 complete: lint gate, coverage gate, full typecheck.**
  Biome error-gate clean (warnings visible, non-blocking); `noUnusedLocals` and
  `noUnusedParameters` fail the build. All seven `void x;` suppressions were
  verified dead before removal — an unbuilt lookup map (twice), parameters no
  check ever read, a discarded tally, a write-only array — and the flags then
  surfaced 12 more dead declarations, all fixed. E5 found 21 test type errors
  and one API lie: `insertEntities` demanded full `Entity[]` while minting the
  id itself and ignoring any passed id, so the signature now takes
  `Omit<Entity,"id"|"worldId">` and the `as Entity[]` casts came off. Coverage
  is gated at the measured floor after removing an exclusion that hid the
  server tools (headline 83% was masking cli.ts and doctor.ts at 0%).
  VERIFIED: typecheck exit 0 across all packages and tests · 262/262
  unit+golden · 2/2 e2e · cleanroom GATE GREEN · coverage 77.6/82.9/79.9/77.6.
  A prior session consolidated the 29-tool surface to 11 action-dispatched
  tools with outputSchema on every tool, a MIGRATED_TOOLS map for all 29 old
  names, assertToolSurface() failing at startup on drift, coverage configured,
  and E2/E3 test files — then was interrupted before verifying. Five failures
  on landing, each fixed rather than worked around:
  - The sim submit statsDigest schema demanded the FULL RoundStats shape while
    the receipt deliberately carries a TRIMMED digest. The schema now matches
    the digest, with a comment explaining why extending-then-requiring was the
    exact mismatch a strict client rejects.
  - The world_list status path spread the engine worldStatus (round as NUMBER)
    into a schema promising a STRING. Normalised to the row shape.
  - tools.test.ts asserted retired == 29 - TOOL_COUNT, which only holds if no
    old name survives. Four do, so retired is derived from the migration map.
  - The e2e drove the entire old surface; migrated call by call.
  - report-draft.test.ts assumed listWorlds()[1] is the newest world, but it
    orders created_at DESC. Rewritten to assert the same po_1 resolves to
    different rows in different worlds — what its comment actually claims.
  - adapters.test.ts asserted retired playbook names; updated to the new
    surface plus a tripwire that no playbook names any retired tool.
  VERIFIED: typecheck exit 0 · 255/255 unit+golden · 2/2 e2e · cleanroom GATE
  GREEN · claim check GREEN at 255 tests and 11 tools.
  5.** `bench/select-vendor-pairs.mjs` inverts the failed search. Instead of
  looking for Reddit threads that link an announcement, it looks for reaction
  threads naming a KNOWN vendor, and takes the announcement from that vendor's
  own domain. Neither half depends on a list of publishers, which is what
  defeated the earlier approach — a 60-host denylist cannot anticipate the next
  gaming outlet, but a vendor's own changelog is authoritative by construction.

  It also enforces one reaction thread per vendor. Without that, all 7 initial
  candidates came from a single ONLYOFFICE licence dispute, so the benchmark
  would have measured one event five times and learned nothing about the other
  vendors. It collects 3× the target as candidates because verification rejects
  roughly half; stopping at N candidates yielded 3 verified from 10 vendors.

  **Verified pairs: Flathub (r/linux, 116c), Hetzner (r/sysadmin, 53c),
  Scaleway (r/sysadmin, 12c).** Distinct vendors, distinct change types (licence
  compliance, price adjustment, pricing strategy).

  Seven candidates were rejected, and the rejections are the useful part. Two
  screens were wrong and the data was right, both times:

  - A commerce-keyword screen rejected ONLYOFFICE and Flathub, which are
    specific first-party posts whose *sidebars* contain "all posts", and later
    rejected the Bitwarden premium price increase, which says "Get Started
    Free" in its plan table. Commerce words are now a tie-breaker; the primary
    test is whether the vendor states a concrete change.
  - A change-language screen recognised only future tense ("we are increasing
    prices") and rejected Hetzner, whose page says "the price adjustment took
    effect … starting 15 June". An announcement you would have held before
    reacting is usually one that is already in effect, so the majority of real
    announcements were being rejected. Both tenses now pass.

  The remaining rejections are genuine: blog index pages (ONLYOFFICE, Proton,
  Mullvad), advocacy rather than announcement (Mullvad open letter), and
  documents with no first-party change statement (Synology release notes,
  Bitwarden's marketing-shaped resource page).

  **Why 3 and not 5, stated plainly rather than tuned away.** I could reach 5
  tomorrow by loosening `FIRST_PARTY_OWN` until more pages passed — and that is
  precisely the post-hoc selection the seal exists to prevent. The screens were
  already revised six times during this step. Rather than tune a seventh time
  to hit a number, the shortfall is recorded and N=3 is used, or the extra
  vendors are given announcements that are unambiguously first-party (a specific
  changelog entry rather than a blog index) and re-run from a fresh selection.
- 2026-09-28 — **C1 complete: the Objection Dossier exists end to end.**
  Engine `dossier.ts` builds a second task over the report's identical evidence
  (same stats pack, same quote bank), validates drafts with the same citation
  and numeric integrity, and renders the five-section artifact: ranked
  objections with steelmen and blast radii, the strongest critic, a genuinely
  strong counter-case, the weakest load-bearing claim with its breaking
  question, and a ranked test plan where every question states what would stop
  the launch. No schema migration was needed: task kind "dossier" rides the
  free-text kind column, and versions live as world-dir files. Server
  `report({mode:'dossier'})` plans, submits (dispatching validators by task
  kind, because validating a dossier as a report rejects a correct draft), and
  exports dossier-N.md. Five golden tests pin both directions plus the
  single-task-mint invariant.
  VERIFIED: typecheck exit 0 · 267/267 unit+golden · 2/2 e2e · cleanroom GATE
  GREEN · claim check GREEN at 267 tests and 11 tools.
- 2026-09-28 — **E6 complete: the replay contract is now proven across
  runtimes, not just within one process.** The golden test only shows two runs
  agreeing in the same process; ICU collation, Math internals, and key ordering
  can all differ across Node majors. Twelve `localeCompare` call sites in the
  deterministic path used the system default locale, which varies by OS as well
  as by Node — all pin `"en"` now (no output change locally, confirmed by the
  still-green byte-identical replay). `tools/golden-hash.mjs` runs a fixed
  pipeline and compares against `bench/golden-hash.txt`; CI runs it on Node 20,
  22, 24 × ubuntu/windows/macos. The script refuses to paper over a red result:
  regenerating the hash to make CI green is forbidden by its own output text.
  Also fixed a latent CI bug found while wiring it up: the claims job ran
  `node tools/verify-claims.mjs` with the murmur working directory, where no
  `tools/` exists — both root-level script steps now pin the workspace root.
- 2026-09-28 — **D1 resolved downward, and this is the most important finding in
  the whole effort. Only ONE valid pair exists, and the corpus cannot produce
  more.** The earlier "5 verified" was partly false.

  Two of the five were false pairs, caught by fixing the verification rather
  than the data. The verification had only ever checked one direction — that
  the announcement shared a term with the reaction — which is satisfied by a
  thread merely *mentioning* a vendor:

  | pair | announcement | reaction actually about | passed on |
  |---|---|---|---|
  | Mullvad | removing OpenVPN | a UK age-verification letter | "mullvad" |
  | Hetzner | price adjustment | an 18 TB data purge over billing | "last" |
  | Proton | Unlimited price change | Tuta vs Proton for private mail | "email", "mail", "private" |

  Replaced with a test needing no tuned threshold: the reaction must **reference**
  the announcement — link it, or quote a distinctive 6–8 word phrase verbatim.
  Both are deliberate acts that cannot happen by accident. The search covers
  every comment, not just the opening post, because a link in a top comment is
  the most common way a community surfaces an announcement.

  **Result: 1 pair (Scaleway), the only thread in the candidate set that links
  its own announcement.** The other candidates are genuine, substantial
  discussions of real vendor changes — the Flathub AI-slop thread is 116
  comments of high-quality argument — but they are not reactions *to a specific
  first-party announcement*, so using them as ground truth answers a different
  question than the one under test.

  **Why this is a finding rather than a bug.** Public threads discussing a
  vendor's change almost never link that specific announcement: they link news
  coverage, or nothing at all. That is why the original approach kept landing on
  publishers, and why filtering publishers was whack-a-mole. Arctic Shift was
  also probed for a cleaner inversion — searching Reddit *for the announcement
  URL* — and it supports neither body nor URL search (`q`, `selftext`, `domain`
  all return HTTP 400), so a high-precision corpus cannot be enumerated from
  this source at all.

  **Consequence for D4/D5, stated plainly: the kill criterion cannot be validly
  applied.** A ±0.15 absolute recall difference is not resolvable at N=1, and the
  one surviving thread yields only 1–2 objections from 12 comments, so a
  high-recall result is nearly free to obtain by chance. Running the arms would
  produce a number, and that number would be noise wearing a decimal point.

  **What would actually resolve it**, in increasing order of practicality:
  1. A vendor-relationship route — pick 20 changelog URLs first, then ask each
     vendor's community for the reaction thread. Highest precision, needs
     outreach.
  2. GitHub issues: a licence or policy change generates a reaction thread in
     the repository's own issue tracker, and the commit/issue and the PR
     announcement share a URL by construction. No linking problem at all.
  3. HN Algolia API, which does support full-text and URL search and is free.
  4. The official Reddit OAuth API, whose search does index post bodies, unlike
     the Arctic Shift mirror. Blocked pending Responsible Builder Policy
     approval.

  Until one of those exists, the honest statement is: **Murmur's recall against
  real reactions is unmeasured.** Not low. Not high. Unmeasured.
