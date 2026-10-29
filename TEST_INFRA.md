# E2E Test Infra: Market Twin Simulation Platform

## Test Philosophy
- Opaque-box, requirement-driven: Derived from `ORIGINAL_REQUEST.md` and user-facing specifications without internal module dependencies.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Zero-Egress & Deterministic: Hermetic execution guaranteed in all environments.

## Feature Inventory & Test Matrix
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Workload) |
|---|---------|----------------------|:-----------------:|:-------------------:|:----------------------:|:-----------------:|
| F1 | Windows Stability & Test Timeouts | R6 | 5 | 5 | ✓ | ✓ |
| F2 | Aspect-Based Entity Sentiment | R6 | 5 | 5 | ✓ | ✓ |
| F3 | Backlash Cascade Dynamics (No Lurker Suppression) | R3, R6 | 5 | 5 | ✓ | ✓ |
| F4 | Multi-Platform Discourse Ingestion (Reddit, HN, X, GitHub) | R1 | 5 | 5 | ✓ | ✓ |
| F5 | Historical Backlash Corpus (Unity, Docker, Redis/HashiCorp) | R1 | 5 | 5 | ✓ | ✓ |
| F6 | Seed Ingestion MCP Extensions | R1, R6 | 5 | 5 | ✓ | ✓ |
| F7 | Vectorized Macro Graph Dynamics (100k+ Nodes) | R2 | 5 | 5 | ✓ | ✓ |
| F8 | Micro-Macro Decoupled Simulation Loop | R2 | 5 | 5 | ✓ | ✓ |
| F9 | Outrage Amplification & The Ratio | R3 | 5 | 5 | ✓ | ✓ |
| F10 | KOL / Influencer Centrality Weighting | R3 | 5 | 5 | ✓ | ✓ |
| F11 | Adversarial Minimax War Room (4 Turns) | R4 | 5 | 5 | ✓ | ✓ |
| F12 | Churn ARR Risk Projections & Waterfall | R5 | 5 | 5 | ✓ | ✓ |
| F13 | Competitor Migration Inflow Maps | R5 | 5 | 5 | ✓ | ✓ |
| F14 | Press Headline Predictors | R5 | 5 | 5 | ✓ | ✓ |
| F15 | Automated "Vaccine" Copy Rewriter | R5 | 5 | 5 | ✓ | ✓ |
| F16 | Modernized MCP Tools Integration | R6 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test Runner: Vitest (`npm run test:e2e`, which includes `tests/e2e/market-twin`, or `vitest run tests/e2e/market-twin` for that suite alone)
- Invocation: Native CLI / MCP client harness executing JSON-RPC calls over stdio and direct engine public APIs.
- Pass/Fail Semantics: Exit code 0, all assertions pass, no timeouts, zero unhandled rejections, clean SQLite cleanup.
- Directory Layout: `murmur/tests/e2e/market-twin/`
  - `tier1-features/`
  - `tier2-boundaries/`
  - `tier3-pairwise/`
  - `tier4-scenarios/`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Expected Outcome |
|---|----------|--------------------|------------------|
| 1 | Unity 2023 Runtime Fee Backlash Replay | F4, F5, F7, F9, F10, F11, F12, F13, F14, F15 | Replays 20c install fee backlash; predicts >15% ARR churn, Godot migration inflow >60%, viral headlines, and evaluates "Safe Harbor" copy rewrite. |
| 2 | Docker Hub 2023 Free Team Deprecation | F4, F5, F9, F11, F12, F13, F15 | Detects OSS maintainer outrage, organization account abandonment, GitHub Packages migration, and generates Grandfathering Vaccine. |
| 3 | Redis 2024 RSALv2 / SSPL License Pivot | F4, F5, F8, F9, F10, F11, F13, F14 | Simulates fork momentum (Valkey), Linux Foundation intervention, cloud vendor alignment, and adjudicator retraction recommendation. |
| 4 | Enterprise SaaS Pricing Model Shift (Live 100k Macro Sim) | F7, F8, F9, F10, F12, F16 | Macro graph with 100,000 nodes propagates seat-to-consumption pricing shock with 0 token burn in <200ms total runtime. |
| 5 | Cross-Platform Discourse Ingestion Calibration | F4, F5, F6, F16 | Ingests Reddit r/devops and Hacker News threads through Tri-Tier adapter into MCP world seeds with aspect sentiment. |

## Coverage Thresholds
- Tier 1: ≥80 test cases (≥5 per feature across 16 features)
- Tier 2: ≥80 test cases (boundary & corner cases per feature)
- Tier 3: ≥16 test cases (covering major feature pairs)
- Tier 4: ≥5 realistic end-to-end application scenarios
- Total Target: ≥181 automated tests
