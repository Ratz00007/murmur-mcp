# Benchmark — MurmurBench-0: recall against real reactions

**Status: pilot at N=1. The kill criterion is unresolvable at this N, and that
is recorded here rather than worked around.**

## The question

Does Murmur surface the objections real people actually raised, better than
simply asking a language model the question in one sentence? Not sentiment,
not calibration — objections. One question, one number, one baseline.

## The design

- **Pre-registered.** `bench/PROTOCOL.md` was committed before any thread was
  read, with queries, rubric, both frozen prompts, the matching procedure, and
  the kill criterion: Arm B (full Murmur) must beat Arm A (one-line prompt) by
  ≥0.15 absolute recall@10, or the simulation engine is cut. Amendments are
  visible commits naming what was observed before each change.
- **Two artifacts from two places.** The blind input is the vendor's own
  announcement; the ground truth is the reaction thread. A prepared
  announcement pre-empts its own objections, so a **pre-emption rate** is
  reported beside every recall figure and the arm *difference* is primary.
- **No cherry-picking.** Selection rules, drop reasons, and the dropped-thread
  log are committed. Threads are never silently discarded.

## The corpus finding (the most important result so far)

Only **one** valid (announcement, reaction) pair exists in the reachable
public corpus, and the corpus cannot produce more. Two earlier counts of 3
and 5 were partly false pairs, caught by fixing the verification:

| Pair | Announcement | Reaction actually about | Passed on |
|---|---|---|---|
| Mullvad | removing OpenVPN | a UK age-verification letter | "mullvad" |
| Hetzner | price adjustment | an 18 TB data purge | "last" |
| Proton | Unlimited price change | Tuta vs Proton for mail | "email" |

Shared vocabulary between a vendor and a community thread is nearly always
incidental. The surviving test needs no threshold: the reaction must
**reference** the announcement — link it, or quote a distinctive phrase
verbatim. Only the Scaleway thread does.

Public threads discussing a vendor's change almost never link that specific
announcement; they link news coverage, or nothing. Arctic Shift supports
neither body nor URL search, so a high-precision corpus cannot be enumerated
from that source. Resolving N needs the vendor-relationship route, GitHub
issues, HN Algolia, or the official Reddit API — see `GOAL.md` for the
ordered options.

## The N=1 pilot

- **Ground truth** (`bench/data-vendor/ground-truth/v4.json`): all 12 Scaleway
  comments read against the frozen rubric. ONE objection survives
  ("No clear exit path off Scaleway", evidence oissbbr); 11 exclusions each
  with a reason. Pre-emption rate 0.0.
- **Arm A** (frozen prompt, announcement only): 10 objections, match at rank 7.
  recall@10 = 1.0, recall@5 = 0.0.
- **Arm B** (full MCP pipeline, human host model, 8 personas × 3 rounds,
  dossier v1 with 5 objections): match at rank 2. recall@10 = 1.0.
  Every task receipt and submit is committed under
  `bench/data-vendor/arms/`; the run is auditable.
- **Verdict**: difference 0.0 < 0.15 — NOT MET, and not resolvable. With one
  ground-truth objection both arms score perfectly by construction. The
  directional observation (2nd vs 7th) is recorded as an observation for a
  future protocol, not promoted to a finding.

## What this means

Murmur's recall against real reactions is **unmeasured**. Not low. Not high.
Unmeasured. Nothing in this repository may claim otherwise until N supports
the arithmetic.
