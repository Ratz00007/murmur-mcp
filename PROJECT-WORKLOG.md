# Project Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Plan a plugin/MCP server for all coding agents to replace mirofish.ai / mirofish.my — produce deep-dive PRD + Technical Plan PDF (English).

Work Log:
- Researched mirofish.ai (OSS marketing site) and mirofish.my (SaaS front, "Simulate The Future") via page_reader.
- Researched GitHub repo (666ghj/MiroFish): AGPL-3.0, 74.2k stars, Shanda-incubated; Python 3.11/3.12 backend + Node frontend; requires LLM_API_KEY (OpenAI-compatible) + ZEP_API_KEY (Zep Cloud); 5-step pipeline: graph building (seed extraction, memory injection, GraphRAG), environment setup (persona generation), dual-platform simulation (Twitter/Reddit-style), ReportAgent report generation, deep interaction (chat with any agent).
- AskUserQuestion answers: deliverable = PRD + tech plan (deep-dive 5000+ words, English); architecture = MCP server; scope = full 5-step parity in v1; edge = in-IDE workflow; users = all equally (horizontal); distribution = decide later (compare in plan); tech stack = recommend via scored matrix.
- CRITICAL user constraint: plugin must work as a normal plugin/MCP and NOT require any extra LLM API key — inference must ride the user's existing coding-agent subscription (Codex, Claude, Antigravity, OpenCode, Hermes, etc.). MiroFish = separate company with monthly plans; our solution = alternative powered only by existing coding subscriptions.
- Loaded pdf skill; read SKILL.md, configs/fonts.md, briefs/report.md (complete), typesetting/{cover,palette,charts,overflow,pagination,typography,fill-engine,cover-backgrounds,geometry}.md.
- Design decisions: Template 07 Crystal Blue cover (dark #0a1628 + luminous #4da8da frame) with fixed Template 07 body palette (blue family); ReportLab body with TocDocTemplate + multiBuild; working product name "Murmur" (package murmur-mcp, placeholder); core architecture = Host-Powered Inference (HPI): MCP server is a deterministic LLM-free swarm engine, host coding agent's LLM does all generation via batched generation-task protocol; clean-room reimplementation (no AGPL code).
- Planned artifacts: cover.html, 2 diagrams (pipeline flow, HPI architecture) as Playwright+CSS PNG @2x, 1 matplotlib chart (paid-dependency comparison), body PDF via ReportLab, merged final in /home/z/my-project/download/.

Stage Summary:
- Requirements and skill constraints fully captured; proceeding to asset generation.

---
Task ID: 2
Agent: main (Super Z)
Task: Generate the Murmur PRD + Technical Plan PDF (all assets, body, merge, QA).

Work Log:
- Built cover.html per Template 07 Crystal Blue (794x1123, layered z-index, luminous frame, 1U text-line gaps); passed poster_validate.py (0 errors/0 warnings) and cover_validate.js (no overlaps); rendered via html2poster.js --width 794px.
- Built 2 diagrams via Playwright+CSS -> PNG @2x (shot.js): diagram_pipeline.png (5-stage flow), diagram_hpi.png (Host-Powered Inference architecture); both VLM-verified PASS.
- Built chart_dependencies.png via matplotlib (paid-dependency comparison; charts.md rules: no top/right spines, no grid, value labels); VLM PASS.
- Wrote content in 3 modules (content_part1/2/3.py): 12 chapters, ~8,900 words - Executive Summary; Market Landscape (+comparison table + chart); Vision/Positioning/Naming; Personas; Feature Spec F1-F7 (+pipeline diagram + NFR table); HPI Architecture (+HPI diagram + callouts); MCP Tool Catalog (18 tools in 3 tables + prompts/resources + worked session code block); System Architecture (+data model table); Client Support (+10-client matrix); Tech Stack Decision (+scored matrix, TypeScript recommended 4.70/5); Legal/Licensing/Monetization (+license table, Apache-2.0 recommended); Roadmap/Risks/Metrics (+roadmap + risk register + callouts).
- generate_prd.py: ReportLab body with TocDocTemplate+multiBuild, clickable TOC (dotsMinLevel 0, displayed-number offset fix), Template 07 fixed body palette, FreeSerif/DejaVu fonts + install_font_fallback(), header/footer with roman-i TOC + arabic body numbering, CondPageBreak 25% H1 orphan rule, Paragraph-wrapped table cells with proportional widths + repeatRows, stat callout rows, quote blocks, code blocks, fit_image figures.
- Fixed 3 QA defects: cover page-size normalization threshold (0.1pt strict), em-dash line-start binding (nbsp fix_typography), bullet Helvetica default (bulletFontName=FreeSerif); made esc() sanitize-proof with chr() codes after code.sanitize decoded entities.
- merge_final.py: pypdf cover+body merge, normalized to A4, metadata set.
- QA: meta.brand, font.check (0 issues), toc.check (clean), pages.clean (no blanks), pdf_qa.py --skip-cover = 13/13 PASS. VLM visual checks PASS on 8 sampled pages (last-page "empty" flag disproven by direct measurement: 91% fill, 2449 chars).

Stage Summary:
- Final deliverable: /home/z/my-project/download/Murmur-PRD-Technical-Plan-v1.0.pdf (24 pages, 665 KB, ~8,900 words, 12 chapters, 10 tables, 2 diagrams, 1 chart, clickable TOC).
- Editable sources: /home/z/my-project/scripts/murmur/ (cover.html, content_part*.py, generate_prd.py, merge_final.py) - edit content modules and re-run generate_prd.py + merge_final.py to iterate.

---
Task ID: 3
Agent: main (Super Z)
Task: Build 100% of Murmur per the PRD — production-grade monorepo implementation of the zero-key social-simulation MCP server.

Work Log:
- Loaded PRD source of truth (scripts/murmur/content_part2.py + part3.py: tool catalog tables, 10-table schema, client matrix, NFRs, roadmap).
- Scaffolded npm-workspaces monorepo at download/murmur: packages/engine, server (murmur-mcp), prompts, adapters, templates + tests/{unit,golden,integration,cleanroom} + examples + docs + GitHub Actions CI (Node 20/22/24 + Windows smoke). Apache-2.0, murmur-mcp verified FREE on npm.
- Engine (~5.2k LOC): types/stages/NFR config; seeded RNG (mulberry32 + FNV streams, zero unseeded randomness — test-enforced); SQLite storage (10 PRD tables, WAL, count-based deterministic ids, golden dump normalizer); workspace/.murmur layout (graph.mmd, audit/interviews/qa.jsonl, reports/{slug}/report-N.md, artifacts spill); best-effort PDF text extractor (node:zlib) with host-fallback teaching receipt; extractive digests (scaled 1800-char budget); ontology plan/apply (itemized surgical retry); deterministic graph derivation (alliance/opposition/influence/ownership + tension + communities + stance-affinity follow graph) with budgeted query + Mermaid; personas plan/apply (Big-Five-lite, entity-stance validation, follows/communities wiring) + ≤120-token persona cards + patch; sentiment lexicon (~200 terms, negation/intensifiers, tanh-bounded) + entity-mention attribution; activation (activity × engagement heat × recency backoff, weighted sample); personalized feeds (twitter recency/engagement/follow/viral scoring; reddit vote gravity + thread previews); batch composer with 12k-token response budget (feed-trim then persona-drop); sim ingestion (itemized validation incl. platform/parent/caps/rate-limits, sticky-hold surgical retry + finalize, organic engagement, virality/hot events, episodic memory + compaction, stance migration, round stats, stage advance); aggregate (escalation chains, engagement peaks μ+2σ, leaderboards, sentiment curves); report stats pack + draft validation (3 risks citing real post ids) + Markdown+Mermaid renderer (xychart, stance bars, post index); interview/ask grounded packs with evidence fallback.
- Server (~1.9k LOC): ServerContext (workspace, storage, active-world, resource-discipline reply with artifact spill, audit); 29 MCP tools in 8 modules with teaching receipts; 3 resources; 4 prompt playbooks; MCP sampling as opt-in accelerator (use_sampling); CLI (serve default, doctor, init --client/--template/--write, templates, version) + stderr-only logging.
- Prompts package: murmur-predict/simulate/interview/resume playbooks. Adapters: 10-client registry (claude-code, codex, gemini-cli, antigravity, opencode, hermes, cursor, windsurf, cline-continue, vscode) with snippets/configs/detection. Templates: 5 scenario packs (launch/policy/crisis/finance/fiction).
- Tests: 42 total — engine unit (rng determinism + no-unseeded-randomness scan, text/sentiment/pdf/digest/storage roundtrips), sim unit (activation, platform scoring, card budget, submit validation/sticky retry/finalize), adapters/prompts/templates unit, golden runs (byte-identical replay, F1–F6 acceptance, F5 injection-shift ≥0.1, crash resume), real SDK-client↔server e2e over stdio (29-tool contract, full pipeline → report file, interviews/qa logs, resources, prompts, 12k budget on every response, cross-session resume), cleanroom gate (no network APIs/URLs/keys in bundle, exact dep closure + network denylist, time-to-first-world 0.1s < 120s, workspace isolation).
- Fixed en route: 8 SQL placeholder-count bugs (programmatic fixer + verifier at scripts/fix_placeholders.mjs), insertPost threadId defaulting, vitest project alias inheritance (root resolve.alias not inherited — moved into each project), sticky round-hold across resubmits, personaIds in personas_submit receipt, ask-pack evidence fallback, digest 5-sentence cap → budget-scaled selection, mock-brain extraction quality (article-phrase filter, freq≥2 keywords).
- Docs: root README (install matrix, quickstart, guarantees, layout), packages/server README (npm-facing), CHANGELOG, CONTRIBUTING (binding clean-room + zero-key policies), SECURITY (injection hardening), NOTICE; examples/ (pricing-page.md, FAQ.md, CHANGELOG.md mirroring the PRD worked session + TRY-IT.md paste-ready prompts); docs/Murmur-PRD-Technical-Plan-v1.0.pdf copied in.
- Packaging: git repo initialized (83 tracked files, one feat commit, ~8.0k LOC TS/mjs); npm pack → murmur-mcp-1.0.0-rc.1.tgz (smoke-tested: installs to clean prefix, `murmur-mcp version`/`templates` run); zip archive excluding node_modules/maps.

Stage Summary:
- Deliverables: download/murmur/ (runnable monorepo, 42/42 tests green, build green), download/murmur-mcp-v1.0.0-rc.1.zip (1.6 MB source+dist), download/murmur-mcp-1.0.0-rc.1.tgz (157 KB npm package).
- Zero-key contract verified by gate: server bundle contains no network APIs, no URLs, no key/token surfaces; deps exactly {mcp-sdk, better-sqlite3, zod}.
- npm name murmur-mcp is unclaimed; publish path: npm publish from packages/server after setting repository URL.

---
Task ID: 4
Agent: main (Super Z)
Task: Run a live end-to-end demo of Murmur on the sample scenario and show the user how it works.

Work Log:
- Wrote scripts/murmur/demo-live.mjs: spawns the REAL murmur-mcp server (packages/server/dist) over stdio via the official SDK client — the exact transport Claude Code / Codex / OpenCode use — and drives the full pipeline with the deterministic mock-brain standing in for the host agent's LLM. Narrated 10-stage transcript (connect/contract, world_init, seeds, ontology plan+submit, graph+mermaid, personas+inspect, sim with per-round digests/stats + round-3 event injection, timeline, report plan/submit/export, interview + report_agent_ask with logged answers, crash-proof resume in a fresh client), footer with artifact tree + token budget + timing.
- Demo run 1 exposed two issues: (a) server rooted .murmur/ at /home/z/my-project because findWorkspaceRoot walks up to the enclosing .git (correct-by-design, git-like repo discovery) — demo now pins MURMUR_WORKSPACE env (documented override); (b) genuine production bug: report.ts stance-migration table read topMovers[].persona but the field is personaId → "undefined" persona column.
- Fixed report.ts (cast + renderer), rebuilt engine+server, full suite green: 40 unit/golden + 2 e2e/cleanroom = 42/42.
- Committed fix (90925e6); re-packed murmur-mcp-1.0.0-rc.1.tgz (160 KB) and refreshed murmur-mcp-v1.0.0-rc.1.zip (974 KB).
- Demo run 2 clean: 34 tool calls, 0.6s wall, largest response 3,707/12,000 tokens, world pricing-reaction (14 entities, 12 personas, 26 posts, 31 memories, 5 rounds + injection at r3), report-1.md 7.9 KB with mermaid xychart, stance bars (handles now render), post index; interviews.jsonl + qa.jsonl logged; fresh-session resume to stage reported verified.

Stage Summary:
- Demo workspace with all artifacts: download/murmur-demo/ (.murmur/{murmur.db, pricing-reaction/{graph.mmd,audit.jsonl,interviews.jsonl,qa.jsonl}, reports/pricing-reaction/report-1.md} + DEMO-TRANSCRIPT.md + examples/).
- Demo driver: scripts/murmur/demo-live.mjs (node it to replay; byte-identical given same seed + same brain).
- One production bug found and fixed by the demo (personaId rendering); all 42 tests green; tarball+zip refreshed.

---
Task ID: 5
Agent: main (Super Z)
Task: Report quality overhaul — user rejected the demo report quality ("level zero"); rebuild the report pipeline to analyst grade and re-run the demo.

Work Log:
- Audited the three quality ceilings: (a) mock-brain wrote 8 template sentences on loop, (b) stats pack had no factions/quotes/divergence/projection, (c) renderer was a thin skeleton; also found ontology junk (Pricing typed person, Cloud/Nimbus substring dupes) corrupting news templates and focus selection, and a lexicon-coverage gap (62/129 templates carried no sentiment markers; 3 positive templates contained polarity-inverting words).
- New engine analytics layer (analytics.ts, ~480 LOC): factionAnalysis (supporters/opponents/undecided with leaders, quotes, per-round sentiment, polarization score, verdict), controversyIndex (0-100 with drivers), crossPlatform (per-entity twitter/reddit divergence + escalation roots), personaArcs (starting stances reconstructed from mover history, arc labels, signature quotes), quoteBank (champions/critics/on-the-fence, distinct authors), narrativeTimeline (injections, virality, first flashpoint/rally, peaks, big shifts), momentum (first/second half), projectCurve (least-squares + 2-round extrapolation), amplification (viral posts, amplifiers, organic share), entityTrends.
- report.ts v2: REPORT_INSTRUCTIONS with word budgets; pack v2 (analytics + evidence + consistent totals); depth-enforced validation (exec/traj >= 120 chars, rationale >= 120, mitigation >= 60, >= 2 post ids, >= 3 findings, >= 2 recs — surgical retry feedback); renderer v2 = At-a-Glance dashboard + verdict, 11 numbered sections, 4 mermaid charts (multi-entity sentiment lines, faction pie, projection with extrapolated rounds, engagement bars), faction cards with share bars + leading voices, persona spotlight with before/after stance bars, risk register (severity x likelihood matrix, mitigation, early-warning trigger, evidence quotes), recommendations with expected impact, confidence + limitations, run timeline, 5 appendices (round stats, escalation chains with quoted steps, amplification, post index, methodology + reproducibility). Deterministic date from report.createdAt; focus entity = org-typed word-boundary match in focus, else most-discussed org-typed.
- types.ts: ReportRisk + likelihood/mitigation/trigger, ReportDraft + scenarioRecap/keyFindings/recommendations/limitations (backward compatible); storage default narrative updated; engine barrel exports analytics; no-Math.random scan extended to analytics.ts.
- Mock brain v2: voices.mjs (new, ~330 LOC) — 6 archetype voice packs x 129 slot templates (news pos/neg/neutral, fresh, replies with parent-fragment quoting, reddit comments, titles, closers) + TAGS polarity tag lines + undercut event banks (single-org mention per bank so attribution stays clean); completeSim rewritten — voice lookup, trait modulation (extraversion exclaims, memory-driven follow-ups, openers), event-shape detection (undercut vs increase with victim/attacker parsing), org-aware entity matching, alignment-driven votes/replies/comments, sentence-boundary truncation; completeOntology rewritten — proper-phrase pass, bigram pass (Pricing Change, Free Tier), substring+singular dedup, generic-word demotion, tiered fill (freq-2 domain > rare meaty nouns > generic), proper-noun type rotation (org/product for main actors); completePersonas stances restricted to org-typed entities; completeReportTask rewritten — majority-polarity risk clustering, projections/momentum/controversity/divergence grounded narrative, pluralization fixes.
- Fixed en route: 1 golden failure (entity count 9 < 10 after dedup -> tiered fill restores 12), TDZ shadowing in tier filters, "calpler" typo, 0%-middle contradiction, chart entity selection (salience -> most-discussed + focus first).
- Updated server report tool docs, golden + e2e assertions (At a Glance, Risk Register, Faction Map, Recommendations, Mitigation), demo narration.
- Full suite 42/42 green; cleanroom gate green; committed a2baea8; repacked tgz (189 KB) + zip (735 KB); demo re-run clean (34 tool calls, 0.5s, largest response 4752/12000 tokens).

Stage Summary:
- Demo report: 7.9 KB skeleton -> 24.9 KB analyst-grade document (11 sections + dashboard + 4 charts + 5 appendices), with real persona-voiced discourse, org-correct news framing, grounded numbers in every narrative sentence.
- Deliverables refreshed: download/murmur (runnable, green), download/murmur-mcp-1.0.0-rc.1.tgz, download/murmur-mcp-v1.0.0-rc.1.zip, download/murmur-demo (replayed demo artifacts + transcript).

---
Task ID: 6
Agent: main (Super Z)
Task: Finish the remaining report-quality pass (resume interrupted session) — attributed sentiment, quote ownership, evidence polarity; verify, commit, repack.

Work Log:
- Verified interrupted-session state: analytics.ts/report.ts/mock-brain.mjs had complete uncommitted changes (a suspected syntax error in mock-brain.mjs line 213 was a display artifact — raw byte dump confirmed `motives: [motiveFor(name, type)]` is valid; node --check clean).
- Built engine+server with the pending changes; ran full suite — 42/42 green (golden tests are self-contained A/B replays, no fixtures to update).
- Audited the regenerated demo report: found residual sentiment misclassifications — po_4 ("genuinely loving... no notes") scored -0.32 under Critics; po_7 ("Genuinely good move") scored -0.32. Root causes: (a) negation window 3 leaked across sentence boundaries ("not existential. Genuinely good..."), (b) filler "notes" absorbed nothing ("no notes Solid" flipped solid), (c) lexicon missed inflections (loving/fixed/complained/reliability/renews/anger).
- Wrote scripts/murmur/lexicon-audit.cjs — frequency analysis of the 129 voice templates against the lexicon; identified covered vs uncovered polarity vocabulary.
- sentiment.ts v2: sentence-aware scanning (negation/intensifier state resets at .!?… boundaries), window-1 negation (fillers absorb the flip; intensifiers/downtoners stay transparent — "never crashes" now reads positive, "no notes Solid decision" stays positive), audit-informed lexicon expansion (+60 terms: inflections, community slang, multi-word phrases "no notes"/"cash grab"/"rug pull"/"price hike"/"data loss"/"tone deaf" etc.).
- Added 4 regression unit tests pinning each observed bug (sentence-leak, affirmative slang, negated negatives, doom phrases) — 46/46 green.
- Clean demo re-run (fresh .murmur): 34 tool calls, 0.6s, largest response 4,645/12,000 tokens. Verified quote buckets now semantically correct (champions +0.76/+0.76, critics -0.76/-0.76, on-the-fence 0.00), risk evidence polarity-aligned (R1 cites only +0.91/+0.99/+0.76 posts; R2 one post per platform), Entities table shows Mentions, Appendix B empty-state reads as analysis instead of a missing section.
- Committed 2428498 (6 files, +351/-145); CHANGELOG updated with the quality-pass entry; repacked murmur-mcp-1.0.0-rc.1.tgz (190 KB, smoke-tested: clean-prefix install, version+templates CLI run) and murmur-mcp-v1.0.0-rc.1.zip (1.1 MB, 175 files, verified zero node_modules/.git entries).

Stage Summary:
- Report pipeline complete: 26 KB analyst-grade report with correct sentence-level sentiment attribution, non-repeating quotes across sections, polarity-safe risk evidence, and a sentiment scorer that handles community slang and negation the way a human reader would.
- Suite 46/46 green; cleanroom gate green; all release artifacts refreshed and smoke-tested.
- Deliverables: download/murmur (runnable monorepo), download/murmur-mcp-1.0.0-rc.1.tgz, download/murmur-mcp-v1.0.0-rc.1.zip, download/murmur-demo (fresh artifacts + DEMO-TRANSCRIPT.md).

---
Task ID: 7
Agent: main (Super Z)
Task: Complete all remaining work and make Murmur production-grade ready for the world — 1.0.0 release pass.

Work Log:
- Audited publish readiness: found (a) LICENSE/NOTICE missing from packages/server (files array referenced a nonexistent LICENSE), (b) hardcoded SERVER_VERSION "1.0.0-rc.1" in server.ts — CLI/MCP handshake would disagree with npm after any bump, (c) no repository/homepage/bugs/author metadata, (d) no publish workflow, (e) rc.1 version everywhere, (f) stale README "until published" caveat, (g) latent tsc error in prompts.ts (ZodOptional cast — invisible to tsup/esbuild builds, caught by the typecheck script). CI trigger looked corrupted ("ain]") but byte-dump proved it was the display-layer ANSI artifact again — CI file is correct.
- Version bump 1.0.0-rc.1 → 1.0.0: root + 5 packages + server devDeps cross-refs + package-lock (npm install --package-lock-only; 0 rc.1 refs remain).
- server.ts: SERVER_VERSION now read at runtime via createRequire(import.meta.url)("../package.json") — works identically from src (vitest), dist (bundled), and the installed tarball since package.json always sits one level up; loud "0.0.0" fallback if unresolvable.
- prompts.ts: fixed latent type error (t: z.ZodTypeAny; optional() without the bogus cast).
- Publish metadata: repository/homepage/bugs/author added (placeholder org murmur-mcp — user swaps in their real GitHub URL before npm publish); LICENSE + NOTICE copied into packages/server and added to files array.
- .github/workflows/release.yml: publish on GitHub release (or manual dispatch), gated on npm ci + build + typecheck + test + test:e2e + cleanroom, uploads the .tgz as an artifact, publishes with --provenance (id-token permission) using NPM_TOKEN secret.
- CHANGELOG: proper 1.0.0 entries (root: full release notes incl. report pipeline + scorer v2 + publish readiness, 46-test count; server: concise npm-facing notes). README: source-install note now references murmur-mcp-1.0.0.tgz.
- Full verification on committed state: build green, typecheck green, 46/46 tests, cleanroom GATE GREEN — releasable, working tree clean.
- Release artifacts refreshed in download/: murmur-mcp-1.0.0.tgz (198 KB; contents audited: LICENSE/NOTICE/dist/README/CHANGELOG; clean-prefix install smoke passes — version prints 1.0.0, doctor + templates + init all run) and murmur-mcp-v1.0.0.zip (1.1 MB, 175 files, zero node_modules/.git entries). Old rc.1 artifacts removed.
- Committed fb503a3.

Stage Summary:
- Murmur is 1.0.0, production-ready: publish metadata complete, release automation in place, version source-of-truth unified, all gates green.
- npm name murmur-mcp verified still unclaimed; the only pre-publish TODO is pointing repository/homepage/bugs at the real GitHub repo and setting the NPM_TOKEN secret.
- Deliverables: download/murmur (runnable monorepo, 46/46, cleanroom green), download/murmur-mcp-1.0.0.tgz, download/murmur-mcp-v1.0.0.zip, download/murmur-demo (demo artifacts + transcript).

---
Task ID: 8
Agent: main (Super Z)
Task: Add a small, consistent UI/UX layer — a self-contained HTML dashboard for prediction reports (user: "make a nice small ui ux as well so when it connects and works and provides results it has some consistency").

Work Log:
- Studied report.ts render flow, server report_export tool, and cleanroom gate constraints (no URLs, no network APIs in the bundle — the dashboard must be inline-everything, no CDN, no webfonts, no xmlns).
- Refactored report.ts: extracted the analytics collection block into exported collectReportData() + ReportData — the single source of truth; renderReportMarkdown now destructures it (golden tests confirmed byte-identical output post-refactor).
- New packages/engine/src/report-html.ts (~700 LOC): renderReportHtml() — full dashboard with the Murmur-Crystal dark design system (bg #0a1628, accent #4da8da): sticky topbar with anchor nav, hero question + faction split stacked bar + verdict, 7 KPI cards (with controversy meter), executive summary, sentiment multi-line SVG chart (focus highlighted, -1..1 grid), entity trend table, crowd-said quote bank (champions/critics/fence columns), faction donut (stroke-dasharray rings) + cards with share bars and leader chips, platform divergence with CSS diverging tracks (reddit left / twitter right of a zero line), persona spotlight with before/after stance bars, trajectory projection chart (solid actual + dashed extrapolated + divider), risk register with severity/likelihood pills + mitigation/trigger blocks + evidence quote cards, recommendations, confidence/limitations, run timeline, collapsible <details> appendices A-E, print stylesheet (light theme), footer. All interpolated text HTML-escaped; zero <script>, zero URLs, zero external references.
- worlddir.reportHtmlPath(); server report_export: format z.enum([md,html,both], default md — backward compatible), writes both files, receipt includes files[] + open hint + next-step teaching.
- Tests: 2 new unit tests (complete structure + no-URL/no-script/no-xmlns/no-<link> assertions + HTML-escaping check + byte-determinism across fresh runs — one test-data bug fixed en route: all focus posts were negative so the champions bucket was correctly empty) + e2e extended to export "both" and assert both files. Suite 48/48, cleanroom GATE GREEN (bundle contains zero http(s):// strings).
- Demo updated to format "both"; re-run: report-1.html 61.5 KB alongside report-1.md 26.3 KB.
- Visual QA with headless browser (agent-browser) at 1440x900 and 390x844: 4 SVGs, 22 quote cards, zero page errors/console noise; VLM design review of top/mid/risk sections and mobile view — all four VERDICT: PASS (applied its one suggestion: donut center text 26→30px).
- Docs: README "What you get" gained the .html dashboard bullet; CHANGELOG (root + server) dashboard entries; test counts updated to 48.
- Committed ff63758; repacked murmur-mcp-1.0.0.tgz (222 KB, clean-prefix install smoke: version prints 1.0.0) and murmur-mcp-v1.0.0.zip (1.1 MB).

Stage Summary:
- Murmur results now have a consistent visual identity: every prediction ships as an in-repo .md (diffable) AND a polished self-contained .html dashboard (shareable) generated from one engine computation.
- The dashboard inherits the zero-key/no-egress promise: no JS, no URLs, no external requests — verifiable by opening the file offline.
- Suite 48/48 green, cleanroom green, mobile+desktop visual QA passed; release artifacts refreshed.
