# AMENDMENT 4 — 2026-10-29 — HN Algolia as the pair source

**Status: AMENDMENT TO THE SEALED PROTOCOL.** This file is written and saved
before any HN data is fetched, read, or scored. It appends to
`bench/PROTOCOL.md` §11 (Amendments 1–3). It does not edit the sealed text.

Commit status: not committed by this session. The session was instructed not to
commit. The audit trail is the file's presence plus the fact that no HN query
had been issued at the time of writing.

---

## 1. What was observed before this amendment

These are observations of the corpus and of the retrieval tools. They contain no
objection content: no comment body, no reaction text, and no ground-truth
objection has been read while writing this section.

1. **The vendor-anchored pipeline produced one verified pair.** `N = 1`
   (Scaleway). Four of the five originally reported pairs were rejected by the
   AMENDMENT-3 reference test — the reaction must link the announcement or quote
   a distinctive 6–8 word phrase from it — and the remaining candidates did not
   satisfy it.

2. **Arctic Shift cannot enumerate the link.** The mirror rejects body search,
   URL search, and domain search (`q`, `selftext`, `domain` → HTTP 400). Its
   `/posts/search` endpoint accepts `subreddit`, `title`, `author`, `after`,
   `before`, `limit`, `sort`. Consequence: the inversion "find every thread that
   links this announcement URL" is not expressible against this source, so the
   announcement↔reaction edge can only be discovered by enumerating threads and
   testing each one, which is bounded by subreddit and title terms.

3. **Reddit's own OAuth search, which does index bodies, is unavailable** —
   blocked pending Responsible Builder Policy approval (PROTOCOL.md §3).

4. **The consequence for the decision rule, restated without softening.**
   `N = 1` cannot resolve a ±0.15 absolute difference in mean `recall@10`. This
   is arithmetic about sample size, not a judgement about the result.

This amendment selects a different **source** for the same **pair**. It is not
written because a result was disappointing; it is written because the sealed
protocol already names this path (§11, AMENDMENT-3 consequences, resolution path
3) and the path has not yet been exercised.

---

## 2. The new source

**HN Algolia** — the public search API over Hacker News items.

| Property | Value |
|---|---|
| Base | `https://hn.algolia.com/api/v1/search` and `https://hn.algolia.com/api/v1/search_by_date` |
| Auth | none |
| Cost | free |
| Full-text search | yes, over story titles, story text, comment text, and story URLs |
| URL search | yes — a story's `url` field is searchable, and comments containing a URL are full-text searchable |
| Filters used | `tags=story`, `tags=comment`, `numericFilters=created_at_i>…,created_at_i<…` |
| Rate limit | polite use only; ~1 req/sec, descriptive User-Agent, backoff on 429 |
| Permalink form | `https://news.ycombinator.com/item?id=<objectID>` |

Why this source satisfies the AMENDMENT-3 requirement rather than bypassing it:
AMENDMENT-3 fixed the two-artifact structure (first-party announcement as blind
input, community reaction as ground truth) and fixed the linking rule (the
reaction must link or name a resolvable first-party announcement). HN Algolia
makes the *link direction* searchable, which is the only thing Arctic Shift
could not do. The structure and the linking rule are unchanged.

---

## 3. The new inclusion rule (mechanical)

A **pair** is one `(announcement, reaction)` tuple. It qualifies only if **all**
of the following hold. Each is a test on retrieved fields, not a judgement:

**(a) First-party announcement.**
The announcement URL's registrable domain equals, or is a subdomain of, the
vendor's own domain. Third-party coverage (news sites, blogs, aggregators,
`news.ycombinator.com` itself, `github.com/<other>` mirrors) is **not** an
announcement for this purpose. The domain allow-list is declared in the script
before any query runs, one entry per vendor, and is not extended after seeing
results.

**(b) A DIFFERENT HN item references that exact announcement.**
The reaction item must be a different HN object from the announcement item, and
must satisfy **at least one** of:

- **B1 — exact URL link.** A comment (or the reaction story's own `url`) contains
  the announcement URL. Matching is on the URL with scheme, `www.`, trailing
  slash, and query string normalised away; the path must match exactly. A bare
  domain root does not count — the announcement must be a specific document.
- **B2 — verbatim quote.** The item's text contains a contiguous 6–8 word
  sequence, lowercased and punctuation-stripped, taken from the announcement
  document's own text. Six words is long enough that a community member
  reproducing it is quoting, not coinciding.

Both are deliberate acts. Neither uses a similarity score, an embedding, or a
tuned threshold — the same reasoning as AMENDMENT-3, applied to a source where
the link is actually searchable.

**(c) One reaction thread per vendor.**
At most one reaction item is admitted per vendor. If several qualify, the one
with the earliest `created_at` after the announcement wins, deterministically,
and the others are logged as `additional_reaction_for_same_vendor`.

**Retained from the sealed protocol and from AMENDMENT-3, unchanged:**

- The reaction item must be created **before the protocol seal** (no recency
  bias) and **after the announcement** (a reaction cannot precede its cause).
- The reaction item must have **≥ 10 comments** (enough signal to extract
  objections) — read from the Algolia `num_comments` field, then confirmed on
  fetch.
- The reaction must **discuss the change**, not merely contain the link
  (`self_promotion_not_a_reaction`, `thread_does_not_name_the_vendor` still
  apply).
- Every rejection is logged with a reason string. Nothing is deleted.

**Rejections are the default.** The script has no "best effort" path: if the
link or quote reference cannot be re-established in `--verify` mode, the pair is
dropped, not downgraded.

---

## 4. What this amendment does NOT change

Explicitly and bindingly:

- **The kill criterion is unchanged.** Arm B must beat Arm A by **≥ 0.15
  absolute mean `recall@10`**, or the simulation engine is cut. Same threshold,
  same direction, same consequence.
- **The arms are unchanged.** Arm A is the frozen one-call baseline prompt
  (PROTOCOL.md §7). Arm B is the full pipeline (§7). Same host model, same
  temperature, same blind input.
- **The rubric is unchanged.** PROTOCOL.md §6, verbatim, including the frozen
  extraction prompt and the exclusion list.
- **The ground-truth definition is unchanged.** Ground truth is the set of
  distinct objections that materialised in the real reaction thread. HN comments
  are a reaction corpus in exactly the sense Reddit comments were.
- **The blind input is unchanged.** Both arms receive the announcement artifact
  only — title and body text. No comments, no platform, no score, no date.
- **The pre-emption rate control is unchanged** and is still reported beside
  every absolute recall figure.
- **The scoring procedure is unchanged.** Human matching, not embedding
  similarity. Per-thread numbers plus the mean.
- **The compliance rules are unchanged** (§3): read-only, non-commercial, no
  redistribution, no training, no named real person as a persona, no opinion
  attributed to a named real person. Ground truth is the objection, not the
  author. HN usernames are treated exactly as Reddit usernames were: never
  stored in an objection label, never used as a persona.

---

## 5. Residual confound, declared now

**HN's audience skews technical and start-up/engineering-oriented; Reddit's
skews consumer.** The same vendor change that draws "this breaks my workflow and
the migration path is undocumented" on HN may draw "I am cancelling" on Reddit.
Therefore:

- An HN-derived ground truth is **not** a drop-in replacement for a
  Reddit-derived one, and results from the two sources must not be pooled into
  a single mean without saying so.
- The **arm difference** remains the primary metric, and this confound hits both
  arms equally, so it does not bias the comparison the kill criterion rests on.
  It does limit external validity: a result from HN says what technical readers
  objected to.
- Absolute recall on HN ground truth must be reported with the platform named,
  never as "Murmur's accuracy".

A second, smaller confound: HN comment threads are flatter and shorter than
Reddit's, and HN's voting surfaces the strongest objection early. Both arms see
the same thread, so the comparison is unaffected; the absolute objection count
per thread may be lower.

---

## 6. Failure clause

If this amendment's pipeline yields **0 or 1** verified pairs, that is the
finding, and it is reported as such. The inclusion rule in §3 is **not** to be
loosened afterward to reach a number. Loosening it would be the post-hoc
selection the seal exists to prevent, and would make the resulting recall
meaningless in a way that no amount of disclosure repairs. If the yield is
insufficient, the honest statement remains the one already recorded: Murmur's
recall against real reactions is **unmeasured**.

---

## 7. Run record — appended AFTER the run, not part of the pre-registration

Written after `bench/fetch-hn-pairs.mjs` was executed. Recorded here so the
outcome is visible next to the rule that produced it.

**Yield: 1 verified pair.**

| vendor | HN item | announcement | evidence |
|---|---|---|---|
| Hetzner | 48540844 | `docs.hetzner.com/.../price-adjustment/` | story `url` IS the announcement; 101 top-level comments; 550 points; 2026-06-15 |

**Rejections (10), by reason:**

| n | reason |
|---|---|
| 3 | `fewer_than_10_top_level_comments` — Flathub 45693626 (0), Scaleway 47933716 (0), Scaleway 47944914 (1) |
| 2 | `no_first_party_voice_about_its_own_offering` — Bitwarden, Nextcloud announcements failed the screen |
| 2 | `no_hn_item_references_the_announcement` — Mullvad (87 comment hits, 0 exact URL), Proton (100, 0) |
| 1 | `commercial_or_catalog_page_not_an_announcement` — ONLYOFFICE |
| 1 | `story_url_is_not_the_announcement` — Hetzner 48392732 links a different first-party page |
| 1 | `reaction_precedes_announcement_publication` — Hetzner 47120145 (2026-02-23) predates the page's own creation date (2026-06-15) |

**One implementation correction made during the run, disclosed:** the retained
rule "the reaction must be created after the announcement" was declared in §3
but not implemented in the first pass, and the first pass selected Hetzner
47120145 — a February story linking a URL whose page was created in June, i.e.
a reaction to a *different* change at the same address. Implementing the
declared rule moved the pair to 48540844 and left the count unchanged at 1. No
inclusion criterion was added, removed, or loosened; a rule that was already
stated was applied.

**Total corpus after this amendment: 2 verified pairs** (Scaleway/Reddit from
AMENDMENT-3, Hetzner/HN from this one). That remains insufficient to resolve a
±0.15 absolute difference in mean `recall@10`, and this document does not claim
otherwise.

