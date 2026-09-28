# MurmurBench-0 — Pre-Registered Protocol (SEALED)

**Status: SEALED.** This document is committed *before* any evaluation thread is
read, fetched, or scored. The git commit timestamp on this file is the audit
trail. Any change after the seal must be a new commit that explicitly says
`PROTOCOL AMENDED` and names what changed and why. Amendments made *after*
seeing results are recorded in the Results section, not silently applied.

## 1. The question

Murmur is repositioning from "predicts how your audience reacts" to "finds the
objections that will kill the change, and tells you which ones to test with a
real human." The 2026 literature says the predictive version does not work:

- Seshadri et al., *"Lost in Simulation"* (ACL 2026) — LLM-simulated users show
  ECE of 15–20 points against real users, and results swing 9pp with the
  simulator model.
- Chen et al., *"When Synthetic Users Fail"* (arXiv 2607.26348) — no LLM beats
  the best non-LLM baseline on real survey data; segment targeting is wrong in
  roughly half of US cases.

So the claim under test is deliberately narrow and falsifiable:

> **Does Murmur surface the objections that real people actually raised, better
> than simply asking a language model the question in one sentence?**

Not "does Murmur predict sentiment." Not "is Murmur calibrated." One question,
one number, one baseline.

## 2. Why the seal exists

The failure mode this protocol exists to prevent is not bad data. It is
**selection bias in favour of the tool being evaluated.** With 5 threads and a
project we are emotionally invested in, it is easy — without any dishonesty —
to drop the thread Murmur missed, the thread that was too niche, the thread
where the backlash was purely political. What survives is a number that is true
and meaningless.

Therefore:

- Queries, sort order, sample size, inclusion and exclusion criteria, the
  extraction rubric, the baseline prompt, and the scoring formula are all fixed
  **here**, in advance.
- Arm A and Arm B see identical blind inputs.
- Neither arm sees the thread or its comments until scoring.
- Dropped threads are logged with a reason. Never deleted.
- Any amendment is a visible commit.

## 3. Data source and compliance

| Item | Decision |
|---|---|
| Primary source | **Arctic Shift** (`arctic-shift.photon-reddit.com`) — public archive, no auth, no signup, usable today. Read-only, cite permalinks. |
| Secondary source | Official Reddit OAuth API (100 QPM, non-commercial, Responsible Builder Policy approval). Swap in once approved; the protocol is source-agnostic. |
| Unavailable | Pushshift (API revoked 2023). Commercial API (~$12k/mo minimum) — never. |

**Compliance rules, non-negotiable:**

1. Read-only. Non-commercial. Every observation records the source permalink.
2. No redistribution of the Reddit corpus. We store only what the rubric
   requires plus permalinks.
3. No model training on this data. It is evaluation ground truth only.
4. **A real Reddit username is never a Murmur persona.** Real comments are
   ground truth about *which objections arose*. Murmur's personas are invented
   critics. These two namespaces never touch, in storage, in prompts, or in
   reports. No output may attribute an opinion to a named real person.
5. Rate limits and User-Agent rules are respected per source.

## 4. Observation selection (pre-registered)

**Queries — fixed, run verbatim:**

```
subreddit:SaaS        "price increase"
subreddit:programming  "api deprecation"
subreddit:webdev       "pricing"
subreddit:sysadmin     "license change"
subreddit:selfhosted   "subscription"
```

**Sampling:** sort by `created_utc` **descending**; take the first 5 results
per query; take the first 1 thread from each query in the order listed above.
Target N = 5 threads. If a query yields zero usable results, record that and
move to the next query. Never substitute a query that "gives better results."

**Inclusion — a thread qualifies if all hold:**

- It is a **public post** in one of the five subreddits above.
- Its **title or body announces a specific, material change** to a product's
  price, licensing, API surface, or terms.
- The change is described **in the post itself** (self-contained; no link chase
  required to know what changed). If the substance is behind an external link,
  exclude and log.
- The thread has **at least 10 comments** (enough signal to extract objections).
- The thread was created **before this protocol was sealed** (no recency bias
  toward whatever is trending now).

**Exclusion — log every exclusion with a reason:**

- No identifiable change (memes, weeklies, giveaways, hiring posts).
- The reaction is dominated by something other than the change (elections,
  wars, unrelated drama in the comments).
- Fewer than 10 comments.
- Announcement is behind an external link.
- Deleted or quarantined.

**No exclusion may be added after the seal that is not listed above.** A new
exclusion criterion requires a `PROTOCOL AMENDED` commit.

## 5. Blind input

For each selected thread, Arm A and Arm B receive **only**:

- The **announcement artifact**: the post's title and body text.
- Nothing else. No comments. No subreddit. No score. No date. No replies.

This is the honest analogue of the founder's situation: here is the change I am
about to ship, tell me what will go wrong.

## 6. Ground truth extraction (pre-registered rubric)

Ground truth = the set of **distinct objections** that materialised in the real
comment thread.

**Definition of an objection:** a specific, actionable complaint or concern
*about the announced change*, raised by at least one commenter. It must be
resolvable to a short label (3–10 words).

**Not objections** (excluded from ground truth):

- General approval without a specific concern.
- Jokes, memes, meta-commentary about the subreddit.
- Off-topic replies.
- Opinions about something other than the change.
- Pure speculation about events *after* the announcement that do not concern the
  change itself.
- Personal anecdotes with no critique of the change.

**Procedure:**

1. Fetch all top-level comments (depth ≤ 2; deeper nesting adds signal noise
   relative to cost for N=5).
2. Apply the rubric. One LLM pass, fixed prompt, temperature 0.
3. **Hand-audit every extracted objection** for N=5. The audit is manual and
   its agreement rate is reported. With 5 threads, full audit is affordable;
   there is no excuse for a sample.

**Frozen extraction prompt** (verbatim, used for all threads and both reruns):

```
You are annotating a real discussion thread in which a product change was
announced. Read the announcement and the comments. List every distinct
objection that commenters raise ABOUT THE ANNOUNCED CHANGE.

An objection is a specific, actionable complaint or concern about the change,
raised by at least one commenter. Label each in 3-10 words.

EXCLUDE: general approval, jokes/memes/meta, off-topic replies, opinions about
something other than the change, speculation about post-announcement events
that do not concern the change, and personal anecdotes with no critique.

Return JSON: {"objections": [{"label": "...", "evidence_comment_ids": ["..."],
"paraphrase": "..."}]}

Return only objections supported by at least one specific comment. If there are
fewer than 3, return what exists. Do not pad.
```

## 7. Arms

Both arms are run by the **same host LLM, same temperature, same session type**.
The only difference is the pipeline.

### Arm A — naive baseline (the control)

One call. Frozen prompt, verbatim:

```
Here is a product change we are about to ship:

<ANNOUNCEMENT>

List the 10 strongest objections people will raise, most damaging first. For
each: a 3-10 word label, one sentence explaining the objection, and how much
damage it would do if it turned out to be true (high/medium/low).

Return JSON: {"objections": [{"label": "...", "explanation": "...",
"damage": "high|medium|low"}]}
```

No personas. No graph. No feed simulation. No sentiment scoring. No rounds.

### Arm B — full Murmur

The full pipeline, blind, on the same announcement:

`world_init` → seeds → `ontology_plan`/`submit` → `graph_build` →
`personas_plan`/`submit` → `sim_configure` → N rounds of
`sim_next_batch`/`sim_submit_generations` → `report_plan`/`submit`.

Fixed seed. Pinned host model. The engine's existing determinism contract
(seeded RNG, byte-identical replay) applies.

Arm B is evaluated on the **objections it surfaces**, not on sentiment
magnitude. Sentiment accuracy is explicitly out of scope for MurmurBench-0 —
see §10.

## 8. Scoring (pre-registered)

**Matching.** An Arm objection matches a ground-truth objection when a human
reviewer, blind to which arm produced it, judges them to be the same complaint.
Matching is done by the reviewer, not by embedding similarity — no threshold is
tuned, because tuning a threshold after seeing results is the same bias in a
smaller window.

**Metrics:**

- `recall@k` = (matched ground-truth objections) / (total ground-truth
  objections), where k = 5 and k = 10, taking the arm's top-k by its own
  ranking.
- `precision@k` = (matches in top-k) / k.
- Reported per thread, plus the mean.

**The decision rule, fixed in advance:**

> If Arm B's mean `recall@10` does not exceed Arm A's by **≥ 0.15 absolute**,
> the social-graph simulation engine is **cut**. The product becomes the thin
> version: objection extraction, machine-verified numbers, and a test plan.
> This is a win, not a loss — a tool that beats a one-line prompt is honest, and
> one that does not is a prompt wrapper with 6,000 lines attached.

This threshold is deliberately set so that "Murmur ties the baseline" is a
failing result. We are testing whether complexity earns itself.

**Reporting obligations, whatever the outcome:**

- Both arms' raw outputs, verbatim.
- Every thread with its permalink.
- Every dropped thread with its reason.
- The hand-audit disagreement list.
- Per-thread numbers, not just the mean — an average can hide the failure mode.
- Explicit statement of where both arms are **weak**.

## 9. Known limitations of MurmurBench-0 (stated now, not later)

This is a small, narrow benchmark and will be treated as such:

1. **N = 5.** Enough to make a go/no-go decision. Nowhere near enough to claim
   a general accuracy figure. A published recall from N=5 must never be
   described as Murmur's "accuracy."
2. **Reddit is not the ICP.** Founders shipping pricing changes face customers,
   not subreddit commenters. Reddit reactions are a real, public, linkable
   record — which is why they are usable ground truth — but they are not a
   random sample of the affected population.
3. **Thread selection is not random.** We sample recent posts matching
   pre-registered queries. This is convenience sampling, and the threads that
   reach comment-section prominence are systematically more contentious than
   average.
4. **Objection recall is not sentiment accuracy.** Do not read a good
   MurmurBench-0 result as evidence that Murmur predicts reaction magnitude. The
   2026 literature is against that, and this benchmark does not test it.
5. **The baseline is strong.** Arm A is a well-formed prompt from a frontier
   model. Many product decisions genuinely do not need more than that, and a
   tie is a realistic outcome, not a surprising one.

## 10. Explicitly out of scope for MurmurBench-0

- Sentiment magnitude prediction (see §9.4).
- Deffuant dynamics, cascade, ensemble, controversy, polarization — the
  simulation internals. They are evaluated only instrumentally, by whether
  Arm B beats Arm A at all.
- Personas resembling real users. Personas are invented critics by design.
- Commercial claims of any kind. This is a non-commercial evaluation.

## 11. Amendments

### AMENDMENT 1 — 2026-09-28 — commit 79045c2

**Added:** `prescreen.mjs`, the semantic half of the §4 inclusion rule.

**Why:** the sealed mechanical filters (`is_self`, `>=10 comments`, pre-seal
date) are necessary but not sufficient. Applied to the first selection run they
admitted a freelancer *asking* how to price a first gig, a sysadmin *asking*
about an E3→E5 migration, and a self-hoster *asking* how to run Proxmox
without a subscription. 0/3 passed "announces a change to its users". The
mechanical rules cannot express a question-versus-announcement distinction.

**Observed before the amendment:** no objection content. Titles, bodies, and
comment counts only.

---

### AMENDMENT 2 — 2026-09-28 — commit 42ef5d5

**Added:** first-party speaker test to the screen.

**Why:** the verb test alone admitted bystanders, not vendors. Observed false
positives, all of which contained a valid announcement verb:

| id | title | why it is not a vendor announcement |
|---|---|---|
| t1 | "Teams Phone massive price increase expected?" | speculation about a third party |
| t3 | "Just bought Roku Ultra 2025 on Amazon and the price dropped $4" | bystander reporting a retail change |
| t4 | "Bootstrapping against Ahrefs/Semrush: I built an SEO SaaS" | self-promotion |

**The circularity this prevents.** In a real price-increase thread most posts
are bystanders *reacting*, not the party announcing. Bystanders reacting is
exactly the population Murmur claims to model, so scoring a bystander thread as
ground truth would make the benchmark largely circular: the thread would
mostly contain the reactions under test, handed over as the answer key.

**Known over-correction, recorded not tuned away:** the test requires
first-party voice, which rejects legitimate third-person announcements such as
*"Scaleway announces price hike effective June 1st, 2026"* where the speaker is
named rather than "we". Yield fell to 3 candidates against a target of N=5.

**Deliberate refusal to tune further.** The screen has now been revised four
times against observed candidates. Continuing to adjust it until exactly five
threads survive would defeat the purpose of pre-registration, even if every
individual revision were correct. AMENDMENT 3 replaces the screen rather than
loosening it.

---

### AMENDMENT 3 — 2026-09-28 — the structural fix

**Problem.** AMENDMENT 2's over-correction exposed the real defect, which is
not the screen. **Reddit's public archive is dense with people reacting to
changes and very thin on the parties announcing them.** Companies announce on
their own blogs and changelogs; Reddit is where the fallout lands. The
original §4 asked Reddit for the wrong half of the conversation. No amount of
screen tuning fixes that — it is a corpus problem.

**Change.** The announcement and the reaction are separated into two artifacts
from two different places:

| Artifact | Source | Role |
|---|---|---|
| **Announcement** | The vendor's own blog post, changelog entry, or pricing page | The **blind input**. What a founder actually holds before shipping. |
| **Reaction thread** | Reddit / HN / GitHub issues | The **ground truth**. What objections people actually raised. |

**Why this is more faithful, not merely more convenient.** It is the exact
founder scenario the ICP describes: *here is my changelog entry, what goes
wrong?* The previous design asked a model to infer an announcement from a
bystander's description of one, which is both unrealistic and circular.

**Retrieval compliance.** The engine's zero-network guarantee is unchanged.
The **host** fetches the announcement — that is what `seed_add_url` already
does, and what the MCP client does natively. Murmur ingests text it is handed.
No fetch capability is added to the server.

**Linking rule, pre-registered.** A reaction thread qualifies only if it
**links to, or names, a resolvable first-party announcement** (a vendor
domain, an official changelog, or the vendor's own account). A thread with no
resolvable announcement is dropped as `no_resolvable_announcement`. The
announcement must be retrievable and must describe the same change.

**New drop reasons introduced here:** `no_resolvable_announcement`,
`announcement_unretrievable`, `announcement_mismatch`.

**New control, declared before running: pre-emption rate.** A prepared vendor
announcement often names its own tradeoffs ("we know this is expensive;
here's the math"). Those objections are *free* for either arm to produce,
because both arms receive the announcement as input. This inflates absolute
recall for both arms.

Therefore the following is reported as a first-class control:

> **pre-emption rate** = the fraction of ground-truth objections that are
> already stated, anticipated, or directly answered in the announcement text
> itself.

Read as follows:

- **Both arms' absolute recall is inflated by the pre-empted subset.** It must
  never be reported without the pre-emption rate beside it.
- **The primary metric is the arm DIFFERENCE, not absolute recall.** A
  pre-emption confound that hits both arms equally does not bias the
  comparison, which is the decision the kill criterion rests on.
- **Recall on the un-pre-empted subset is the discriminating metric.** That is
  the set of objections neither arm could read off the page, and it is where
  Arm B's generation could plausibly add something over Arm A's reading.

A high pre-emption rate is a finding about the benchmark, not a defect to be
hidden: it would mean the benchmark is largely measuring "can you list the
risks this document acknowledges", which is close to trivial, and the results
should be reported with that stated plainly.

**Kill criterion is unchanged.** Arm B must beat Arm A by ≥0.15 absolute
recall@10, or the simulation engine is cut.
