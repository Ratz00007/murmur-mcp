┌────────────────────────────────────────────────────────────────────────────┐
│  MURMUR LIVE DEMO — sample scenario: "Acme Cloud pricing change"               │
│  real MCP server over stdio · the transport your coding agent uses           │
└────────────────────────────────────────────────────────────────────────────┘

  WHO DOES WHAT
  · you               drop docs + ask questions, inside your coding agent
  · agent LLM         the "brain": drafts entities, personas, posts, reports
                    (played today by a deterministic mock — zero API keys)
  · murmur-mcp        deterministic engine: validates, simulates, aggregates
  · workspace         /home/z/my-project/download/murmur-demo


  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 0 · CONNECT — server spawn + contract   (t+0.0s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    connected over stdio · 29 tools · 4 prompt playbooks (murmur-predict, murmur-simulate, murmur-interview, murmur-resume)
    the /murmur-predict playbook your agent expands — first lines:
      I want a social-simulation prediction. Question: How will r/programming and X/Twitter react to our new pricing?
      Sources: (ask me — I may point you at files in this repo, paste text, or give URLs; fetch URLs yourself and pass the extracted text to seed_add_url)
      
      Work the pipeline with the murmur tools, in this order, and obey these rules:
      1. world_init — create a world (short name). If seeds come from files, pass their repo-relative paths to seed_add_files; for URLs, fetch each page yourself and pass url + extracted text to seed_add_url; for pasted notes use seed_add_text. Then seeds_review and show me the digest.
      2. ontology_plan → you complete the task → ontology_submit. If items are rejected, fix only those and resubmit the same task_id.
      3. graph_build, then graph_export_mermaid. Report the number of relations and top tensions.
      4. personas_plan (default 24 personas) → you draft the population → personas_submit. Then persona_inspect on 2-3 personas to sanity-check voice and stances; persona_edit if anything feels off.
      5. sim_configure (default 8 rounds), then loop: sim_next_batch → you write every activated persona's actions (stay in character, react to their actual feed, max 3 actions each) → sim_submit_generations. Repeat until all rounds complete. If submissions are rejected, fix surgically; only use finalize:true if I ask.
      6. report_plan → you draft the narrative from the evidence pack (exactly 3 risks, each citing real post ids) → report_submit → report_export.
      …

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 1 · CREATE THE WORLD   (t+0.2s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ world_init({"name":"pricing-reaction","description":"How will developers react to the Pro plan price change?","seed":"acme-demo-2026"})
    world w_757ac236 · slug "pricing-reaction" · stage: created
    engine tells the agent what is next: seed_add_files / seed_add_text — attach source material to this world

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 2 · FEED IT YOUR DOCS (seeds)   (t+0.2s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ seed_add_files({"paths":["examples/pricing-page.md","examples/FAQ.md","examples/CHANGELOG.md"]})
    examples/pricing-page.md   → sd_1 · 929 bytes
    examples/FAQ.md            → sd_2 · 995 bytes
    examples/CHANGELOG.md      → sd_3 · 500 bytes
    coverage: {"seeds":3,"totalBytes":2424,"largest":995,"notes":[]}
  ➜ seed_add_text({"title":"Competitive context brief","text":"«strategy brief — elided»"})
    sd_4 · 2079 bytes · digest: # Acme Cloud pricing change brief Acme Cloud is raising the price of its Pro plan by 40 pe…
  ➜ seeds_review()
    file  pricing-page.md                             929 B
    file  FAQ.md                                      995 B
    file  CHANGELOG.md                                500 B
    text  Competitive context brief                  2079 B
    coverage: {"seeds":4,"totalBytes":4503,"largest":2079,"notes":[]}
    next: ontology_plan to turn this material into entities, motives and anchors

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 3 · ONTOLOGY — the brain extracts the entities   (t+0.2s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ ontology_plan()
    task t_1 · the brain sees 4 seed digests and is asked for entities + types + salience + motives + anchors
  ➜ ontology_submit({ task_id: "t_1", result: 14 entities })
    inserted 14 entities (engine validated types, salience, anchors):
    Pro Plan Pricing         topic    salience 0.9
    Pricing FAQ              topic    salience 0.86
    Pricing Release          topic    salience 0.81
    Acme Cloud               org      salience 0.77
    Nimbus Labs              org      salience 0.72
    Free Tier                topic    salience 0.68
    Pricing Change           topic    salience 0.63
    Existing Customers       topic    salience 0.59
    Pro Plan                 topic    salience 0.54
    Data Exports             topic    salience 0.5
    … +4 more
    next: graph_build

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 4 · TENSION GRAPH — deterministic derivation   (t+0.3s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ graph_build()
    35 relations · 21 tensions > 0.5 · 13 communities (subreddits derived from entity types)
    top tension: "Pricing Release —opposition→ Acme Cloud (tension 0.83)"
    top tension: "Pricing Release —opposition→ Free Tier (tension 0.8)"
    top tension: "Acme Cloud —opposition→ Nimbus Labs (tension 0.8)"
  ➜ graph_export_mermaid()
    wrote .murmur/pricing-reaction/graph.mmd · 14 nodes · 35 edges — first lines:
      graph LR
        e_1["Pro Plan Pricing (topic)"]
        e_2["Pricing FAQ (topic)"]
        e_3["Pricing Release (topic)"]
        e_4["Acme Cloud (org)"]
        e_5["Nimbus Labs (org)"]
        e_6["Free Tier (topic)"]
        e_7["Pricing Change (topic)"]
        e_8["Existing Customers (topic)"]
        e_9["Pro Plan (topic)"]
        e_10["Data Exports (topic)"]
        e_11["Free Forever (topic)"]
        e_12["On-prem Support (topic)"]
        e_13["Rate Limits (topic)"]
        e_14["Until End (idea)"]
        e_3 -->|"opposition ⚠83"| e_4
      … +47 more lines

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 5 · POPULATION — the brain drafts the personas   (t+0.3s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ personas_plan({"count":12})
    task t_2 · archetype menu the engine offers: power user, casual scroller, pragmatic skeptic, passionate advocate, curious newcomer, industry professional
  ➜ personas_submit({ task_id: "t_2", result: 12 personas })
    population 12 · platform mix {"twitter":6,"reddit":4,"both":2} · 39 follow edges · 18 community memberships
    archetypes {"power user":2,"passionate advocate":2,"curious newcomer":2,"industry professional":2,"casual scroller":2,"pragmatic skeptic":2}
  ➜ persona_inspect({"persona":"p_1"})
    Ada Okafor (@ada0) · power user · twitter
    persona card as the sim will see it (74 tokens, budget 120): {"traits":[["conscientiousness",0.99],["openness",0.91]],"stances":[["Pricing FAQ",0.62],["Acme Cloud",-0.64],["Pricing Release",-0.6]],"activity":0.59}
    stance detail: Pro Plan Pricing -0.01 · Pricing FAQ 0.62 · Pricing Release -0.6 · Acme Cloud -0.64
    follows: @elena4, @ben1, @felix5, @jonas9
    recent posts: 0 (simulation not started yet)

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 6 · SIMULATION — 5 rounds on two platforms   (t+0.3s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ sim_configure({"rounds":5})
    5 rounds configured · stage: configured
  ➜ sim_next_batch()
    round 1 · 5 personas activated · batch ≈ 932 tokens (feeds personalized per persona)
    ── what the brain sees for ONE persona (Ben Sørensen, @ben1) ──
      card: {"id":"p_2","name":"Ben Sørensen","handle":"@ben1","archetype":"casual scroller","platform":"twitter","activity":0.71,"traits":[["conscientiousness",0.25],["extraversion",0.74]],"stances":[["Pricing FAQ",0.82],["Acme Cloud",0.8],["Pricing Release",0.71]],"bio":"casual scroller who lives in release notes."}
      memory: {"summary":"(no prior episodes)","recent":[]}…
      feed (ranked: recency + virality + affinity + stance salience):
      collective: trending [] · events []
      allowed actions: ["post ≤280c","reply ≤280c","repost","quote ≤280c","like"]
  ➜ sim_submit_generations({ task_id: "t_3", generations: 5 persona action sets })
    round 1 applied · 5 posts created · 5 personas acted, 0 lurked
    stats: tw 3 · rd 3 · engagement 6 · "Acme Cloud" sentiment 0.87 · escalations 0
  ➜ sim_inject_event({"text":"Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30%","round":3})
    event ev_9 queued for round 3 — activated personas will see it in their digest
  ➜ sim_next_batch → sim_submit_generations({ round 2, 5 personas })
    round 2 · tw 6 · rd 0 · engagement 10 · "Acme Cloud" sentiment 0.12 +█ · escalations 0 · movers Pricing FAQ 0.82→0.84, Pricing FAQ 0.48→0.51
  ➜ sim_next_batch → sim_submit_generations({ round 3, 5 personas })
    round 3 · tw 3 · rd 1 · engagement 2 · "Acme Cloud" sentiment -0.56 -██████ · escalations 0 · movers Pricing FAQ 0.62→0.5, Acme Cloud -0.77→-0.75
  ➜ sim_next_batch → sim_submit_generations({ round 4, 5 personas })
    round 4 · tw 3 · rd 1 · engagement 3 · "Acme Cloud" sentiment -0.4 -████ · escalations 0 · movers Acme Cloud -0.64→-0.67, Acme Cloud 0.77→0.73
  ➜ sim_next_batch → sim_submit_generations({ round 5, 5 personas })
    round 5 · tw 3 · rd 2 · engagement 4 · "Acme Cloud" sentiment -0.58 -██████ · escalations 0 · movers Acme Cloud -0.73→-0.71, Pricing FAQ 0.8→0.66
    simulation complete: true · stage: all rounds complete — call report_plan to draft the prediction report
  ➜ sim_timeline()
    round │  tw │  rd │ engagement │ sentiment toward "Acme Cloud"
        1 │   3 │   3 │          6 │   0.87 +█████████
        2 │   6 │   0 │         10 │   0.12 +█
        3 │   3 │   1 │          2 │  -0.56 -██████
        4 │   3 │   1 │          3 │  -0.40 -████
        5 │   3 │   2 │          4 │  -0.58 -██████
    engagement peaks (μ+2σ): []

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 7 · REPORT — the brain narrates, the engine grounds it   (t+0.4s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ report_plan({"focus":"developer reaction to the pricing change"})
    task t_8 · the brain gets a stats pack + evidence posts and must cite real post ids in exactly 3 risks
  ➜ report_submit({ task_id: "t_8", draft: recap + findings + trajectory + 3 risks (mitigated) + recommendations + confidence })
    report v1 stored · engine verified every cited post id exists:
      MEDIUM — Hype hardening around Pricing FAQ [po_4, po_7, po_9]
      HIGH — Platform-split narrative on Nimbus Labs [po_1, po_11]
      LOW — Unmuted cluster around @kira10's tweet [po_10, po_11, po_7]
  ➜ report_export()
    wrote .murmur/reports/pricing-reaction/report-1.md (26320 bytes) + .murmur/reports/pricing-reaction/report-1.html (61588 bytes) — dashboard and full report:
    open .murmur/reports/pricing-reaction/report-1.html in a browser: same numbers as the .md, same engine computation

# Murmur Prediction Report — pricing-reaction

> How will developers react to the Pro plan price change?

**Version** 1 · **Scenario** `pricing-reaction` · **Generated** 2026-09-22 · **Seed** `acme-demo-2026`

**Rounds** 5 · **Population** 12 personas · **Ontology** 14 entities · **Platforms** Twitter + Reddit

**Focus** — developer reaction to the pricing change

> Deterministic statistics computed by the Murmur engine; narrative drafted by the host coding agent around those numbers. Reproduce this report by re-running world `pricing-reaction` with seed `acme-demo-2026` and the same host model — every number below is a pure function of the recorded run.

---

## At a Glance

| Simulated posts | Total engagement | Escalation chains | Viral posts | Controversy | Momentum | Most-discussed entity |
|---|---|---|---|---|---|---|
| 23 | 25 | 0 | 0 | **contested** 41/100 | cooling (-44%) | Acme Cloud |

**Verdict —** 7 supporters vs 5 opponents around Acme Cloud (0 still undecided) — the population is deeply polarized. Controversy reads **contested** (41/100).

## 1. Executive Summary

The simulated crowd is contested (controversy 41/100): 7 supporters against 5 opponents around Acme Cloud, with 0 personas still undecided — the persuadable middle is 0% of the population. Sentiment toward Acme Cloud ended -0.58 (from +0.87, souring); engagement is cooling at -44% between halves of the run. No post crossed the virality threshold — reach stayed inside the follow graph, which limits how far any single frame can travel. The strongest signal in the run is hype hardening around Pricing FAQ; the risk register below details what to do about it before this plays out in public.

## 2. Scenario & Population

Simulated 12 personas across 14 ontology entities for 5 rounds of dual-platform mechanics, with 1 injected news event stress-testing the reaction. The population split 7 supporters vs 5 opponents (0 undecided) around Acme Cloud, producing 23 posts and 25 engagement events.

### Entities under watch

| Entity | Type | Salience | Mentions | Motive |
|---|---|---|---|---|
| Pro Plan Pricing | topic | 0.90 | 0 | the debate around Pro Plan Pricing turns on who pays for reliability |
| Pricing FAQ | topic | 0.86 | 7 | the debate around Pricing FAQ turns on value versus lock-in |
| Pricing Release | topic | 0.81 | 1 | the debate around Pricing Release turns on value versus lock-in |
| Acme Cloud | org | 0.77 | 10 | Acme Cloud wants to avoid backlash |
| Nimbus Labs | org | 0.72 | 10 | Nimbus Labs wants to avoid backlash |
| Free Tier | topic | 0.68 | 1 | the debate around Free Tier turns on fairness to early users |
| Pricing Change | topic | 0.63 | 0 | the debate around Pricing Change turns on fairness to early users |
| Existing Customers | topic | 0.59 | 0 | the debate around Existing Customers turns on who pays for reliability |

### Population mix

| Archetype | Personas | Platforms |
|---|---|---|
| casual scroller | 2 | reddit + twitter |
| curious newcomer | 2 | both + twitter |
| industry professional | 2 | twitter |
| passionate advocate | 2 | both + reddit |
| power user | 2 | twitter |
| pragmatic skeptic | 2 | reddit |

### Injected events

| Round | Event |
|---|---|
| 3 | Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30% |

## 3. Key Findings

… +373 more lines (stance bars, post index) — see the file

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 8 · INTERROGATE THE WORLD (F7)   (t+0.4s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ➜ interview_agent({"persona":"p_1","question":"Why do you call the migration guide a paywall?"})
    engine grounded the interview — Ada Okafor · 3 of their posts + 5 memories in the pack:
      po_17 (r4, twitter, sentiment -0.93) Everyone dunking on the 30% increase is missing it: the free-tier limi
      po_21 (r5, twitter, sentiment 0) Update from my last post: The 30% hike isn't even the problem. Shippin
      po_13 (r3, twitter, sentiment -0.54) Four years of advocating Acme Cloud in every architecture review, and 
  ➜ interview_agent({ persona, question, answer: "«in-character answer citing " + po_17 + »" })
    logged: true → .murmur/pricing-reaction/interviews.jsonl
  ➜ report_agent_ask({"question":"What are the posts behind the biggest risk, and how strong is the evidence?"})
    evidence pack (matched: []):
      po_8 @felix5 [tw] r2 sentiment -0.76 — Screaming into the void but: Advising my clients to model 30% churn ri
      po_1 @ben1 [tw] r1 sentiment 0.58 — Screaming into the void but:  scrolled past 40 Pricing FAQ takes today
  ➜ report_agent_ask({ question, answer: "«answer citing " + po_8 + »" })
    logged: true → .murmur/pricing-reaction/qa.jsonl

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STAGE 9 · CRASH-PROOF RESUME — brand-new session   (t+0.4s)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    killed the first client, spawned a fresh server process — the world persists in .murmur/murmur.db
  ➜ world_list()
    1 world: pricing-reaction · reported · round 5/5
  ➜ world_open({"world":"w_757ac236"})
    active again · stage reported · next: report_export — write the report file, or interview_agent / report_agent_ask to interrogate the world
  ➜ world_status()
    stage reported · counts {"seeds":4,"entities":14,"personas":12,"posts":25,"memories":34,"events":19,"reports":1} · next "report_export — write the report file, or interview_agent / report_agent_ask to interrogate the world"

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ARTIFACTS ON DISK (everything is a plain file you can commit)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
pricing-reaction/
  artifacts/
  audit.jsonl  (3265 B)
  graph.mmd  (1827 B)
  interviews.jsonl  (433 B)
  qa.jsonl  (339 B)
reports/
  pricing-reaction/
    report-1.html  (61588 B)
    report-1.md  (26320 B)
murmur.db  (307200 B)

  ──────────────────────────────────────────────────────────────────────────
    tool calls this session: 34 · largest single response: 4645 tokens (budget 12,000) · wall time 0.6s
    determinism: same seed + same generations ⇒ byte-identical replay (enforced by the golden test)
    in real use: YOUR coding agent (Claude Code, Codex, OpenCode, Antigravity, …) writes what the mock
    brain wrote here — the engine validates, simulates and aggregates. No API keys, ever.
  ──────────────────────────────────────────────────────────────────────────
