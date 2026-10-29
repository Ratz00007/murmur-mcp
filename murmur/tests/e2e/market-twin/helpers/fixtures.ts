/**
 * Canonical test fixtures for Market Twin E2E Testing.
 * Includes historical backlash corpus cases (Unity, Docker Hub, Redis, HashiCorp)
 * and multi-platform discourse threads (Reddit r/devops, Hacker News, X, GitHub).
 */
import type { DiscourseThread, HistoricalBacklashCase } from "./contracts.js";

export const UNITY_2023_CASE: HistoricalBacklashCase = {
  id: "unity-runtime-fee-2023",
  title: "Unity 2023 Runtime Fee Backlash Replay",
  vendor: "Unity Technologies",
  announcementDate: "2023-09-12",
  policySummary:
    "Introduction of a $0.20 per-install 'Runtime Fee' on games passing revenue and install thresholds, retroactive to prior engine versions and tracking installs via proprietary black-box telemetry.",
  objections: [
    {
      category: "legal_retroactivity",
      severity: 10,
      claim: "Unilateral retroactive change to previously agreed terms of service for shipped games.",
    },
    {
      category: "financial_install_fraud",
      severity: 9,
      claim: "Developers liable for unverified install spikes, install-bombing attacks, and piracy without verifiable audit logs.",
    },
    {
      category: "business_viability_freemium",
      severity: 9,
      claim: "Free-to-play developers with low ARPU face fees exceeding 100% of gross revenue.",
    },
  ],
  timeline: [
    {
      stage: "announcement",
      daysAfterT0: 0,
      headline: "Unity announces new runtime fee model based on game installs",
      sentimentScore: -0.45,
    },
    {
      stage: "outrage",
      daysAfterT0: 2,
      headline: "Game developers rebel against Unity's disastrous per-install fee",
      sentimentScore: -0.92,
    },
    {
      stage: "boycott",
      daysAfterT0: 5,
      headline: "Over 500 game studios disable Unity ads and threaten mass migration to Godot and Unreal",
      sentimentScore: -0.88,
    },
    {
      stage: "walkback",
      daysAfterT0: 10,
      headline: "Unity apologizes, caps fees at 2.5% revenue share, and eliminates fees on Personal tier",
      sentimentScore: -0.25,
    },
    {
      stage: "aftermath",
      daysAfterT0: 30,
      headline: "Unity CEO John Riccitiello steps down amid permanent trust erosion",
      sentimentScore: -0.35,
    },
  ],
  churnImpact: {
    estimatedARRChurnPercent: 18.5,
    primaryMigrationDestinations: [
      { competitor: "Godot Engine", inflowShare: 0.65 },
      { competitor: "Unreal Engine", inflowShare: 0.25 },
      { competitor: "Custom/In-House Engine", inflowShare: 0.10 },
    ],
  },
};

export const DOCKER_HUB_2023_CASE: HistoricalBacklashCase = {
  id: "docker-hub-free-team-2023",
  title: "Docker Hub 2023 Free Team Deprecation",
  vendor: "Docker, Inc.",
  announcementDate: "2023-03-14",
  policySummary:
    "Emailed notification giving open-source organizations 30 days to upgrade to a paid Team tier ($420/yr) or face deletion of all public image repositories and release namespace squatting.",
  objections: [
    {
      category: "ecosystem_destruction",
      severity: 10,
      claim: "Namespace deletion causes widespread breakage in downstream container CI/CD pipelines.",
    },
    {
      category: "security_namespace_squatting",
      severity: 10,
      claim: "Deleted organization names can be registered by malicious actors to serve supply-chain malware.",
    },
    {
      category: "community_betrayal",
      severity: 8,
      claim: "Open source maintainers who built Docker's network effect are treated as unauthorized freeloaders.",
    },
  ],
  timeline: [
    {
      stage: "announcement",
      daysAfterT0: 0,
      headline: "Docker alerts Free Team accounts of deletion in 30 days unless upgraded to paid tier",
      sentimentScore: -0.55,
    },
    {
      stage: "outrage",
      daysAfterT0: 3,
      headline: "Open source community erupts over Docker Hub repo deletion threats",
      sentimentScore: -0.95,
    },
    {
      stage: "walkback",
      daysAfterT0: 10,
      headline: "Docker officially apologizes and completely rolls back Free Team sunsetting plan",
      sentimentScore: 0.1,
    },
  ],
  churnImpact: {
    estimatedARRChurnPercent: 12.0,
    primaryMigrationDestinations: [
      { competitor: "GitHub Packages (ghcr.io)", inflowShare: 0.58 },
      { competitor: "Quay.io", inflowShare: 0.22 },
      { competitor: "AWS ECR Public", inflowShare: 0.20 },
    ],
  },
};

export const REDIS_2024_CASE: HistoricalBacklashCase = {
  id: "redis-licensing-pivot-2024",
  title: "Redis 2024 RSALv2 / SSPL License Pivot",
  vendor: "Redis Ltd.",
  announcementDate: "2024-03-20",
  policySummary:
    "Abandonment of the permissive BSD-3-Clause license in favor of dual source-available RSALv2 and SSPLv1 licenses, restricting cloud providers from offering hosted Redis without commercial contracts.",
  objections: [
    {
      category: "open_source_definition",
      severity: 9,
      claim: "Redis ceases to be genuine Open Source software per OSI definitions.",
    },
    {
      category: "downstream_distro_purge",
      severity: 8,
      claim: "Linux distributions (Debian, Fedora, Ubuntu) must purge Redis from standard package repos.",
    },
    {
      category: "ecosystem_forking",
      severity: 9,
      claim: "Community and hyper-scalers immediately fork the codebase under neutral governance.",
    },
  ],
  timeline: [
    {
      stage: "announcement",
      daysAfterT0: 0,
      headline: "Redis transitions to dual source-available licensing under RSALv2 and SSPL",
      sentimentScore: -0.6,
    },
    {
      stage: "outrage",
      daysAfterT0: 2,
      headline: "Dev community laments death of open source Redis as distributions prepare removals",
      sentimentScore: -0.85,
    },
    {
      stage: "boycott",
      daysAfterT0: 8,
      headline: "Linux Foundation, AWS, Google, and Microsoft launch Valkey as official open-source fork",
      sentimentScore: -0.75,
    },
    {
      stage: "aftermath",
      daysAfterT0: 45,
      headline: "Major cloud providers adopt Valkey as default in-memory datastore",
      sentimentScore: -0.4,
    },
  ],
  churnImpact: {
    estimatedARRChurnPercent: 22.0,
    primaryMigrationDestinations: [
      { competitor: "Valkey (Linux Foundation fork)", inflowShare: 0.72 },
      { competitor: "KeyDB", inflowShare: 0.15 },
      { competitor: "Dragonfly", inflowShare: 0.13 },
    ],
  },
};

export const HASHICORP_2023_CASE: HistoricalBacklashCase = {
  id: "hashicorp-bsl-2023",
  title: "HashiCorp 2023 BSL License Shift",
  vendor: "HashiCorp, Inc.",
  announcementDate: "2023-08-10",
  policySummary:
    "Switching Terraform, Vault, Consul, and Nomad from Mozilla Public License v2 (MPL 2.0) to Business Source License (BSL 1.1) to block competitive commercial offerings.",
  objections: [
    {
      category: "license_ambiguity",
      severity: 8,
      claim: "Ambiguous definition of 'competitive' leaves internal enterprise tooling in legal limbo.",
    },
    {
      category: "ecosystem_splintering",
      severity: 9,
      claim: "Community creates OpenTofu fork under the Linux Foundation.",
    },
  ],
  timeline: [
    {
      stage: "announcement",
      daysAfterT0: 0,
      headline: "HashiCorp changes core product licenses to Business Source License (BSL)",
      sentimentScore: -0.5,
    },
    {
      stage: "outrage",
      daysAfterT0: 4,
      headline: "The OpenTF manifesto demands return to open source, reaches 10k stars in 72 hours",
      sentimentScore: -0.88,
    },
    {
      stage: "aftermath",
      daysAfterT0: 60,
      headline: "OpenTofu joins Linux Foundation; IBM announces HashiCorp acquisition",
      sentimentScore: -0.3,
    },
  ],
  churnImpact: {
    estimatedARRChurnPercent: 14.2,
    primaryMigrationDestinations: [
      { competitor: "OpenTofu", inflowShare: 0.68 },
      { competitor: "Pulumi", inflowShare: 0.22 },
      { competitor: "AWS CloudFormation", inflowShare: 0.10 },
    ],
  },
};

// Discourse Thread Fixtures

export const REDDIT_DEVOPS_THREAD: DiscourseThread = {
  platform: "reddit",
  threadId: "reddit_devops_licensing_pivot",
  title: "Vendor switches to source-available license. What is your team doing?",
  author: "kube_wizard",
  url: "https://reddit.com/r/devops/comments/xyz123/vendor_switches_licensing",
  timestamp: "2024-03-21T14:32:00Z",
  metrics: { upvotes: 1420, comments: 385, shares: 120 },
  posts: [
    {
      postId: "p_root",
      author: "kube_wizard",
      text: "With the latest license change, our enterprise legal team is asking for an immediate audit. Are people migrating to forks or paying up?",
      timestamp: "2024-03-21T14:32:00Z",
      score: 1420,
      aspects: { legal: -0.7, migration: 0.8 },
    },
    {
      postId: "p_c1",
      parentId: "p_root",
      author: "infra_lead_99",
      text: "We are freezing all upgrades today. We run over 400 clusters and cannot risk ambiguity around what constitutes a 'competitive offering'. Fork migration is already underway.",
      timestamp: "2024-03-21T14:45:00Z",
      score: 840,
      aspects: { legal: -0.9, risk: -0.85, fork: 0.9 },
    },
    {
      postId: "p_c2",
      parentId: "p_c1",
      author: "corp_architect",
      text: "Same here. Our CTO signed off on the Valkey / OpenTofu transition ticket this morning. Never building on single-vendor open core again.",
      timestamp: "2024-03-21T15:10:00Z",
      score: 610,
      aspects: { migration: 0.95, trust: -0.9 },
    },
  ],
};

export const HACKERNEWS_ALGOLIA_THREAD: DiscourseThread = {
  platform: "hackernews",
  threadId: "hn_39785412",
  title: "Why We Are Forking Redis",
  author: "antirez_fan",
  url: "https://news.ycombinator.com/item?id=39785412",
  timestamp: "2024-03-22T08:15:00Z",
  metrics: { upvotes: 2150, comments: 842 },
  posts: [
    {
      postId: "hn_root",
      author: "antirez_fan",
      text: "The decision to abandon BSD-3 is a betrayal of the community contributors who spent a decade optimizing Redis internals. We must fork under neutral Linux Foundation stewardship.",
      timestamp: "2024-03-22T08:15:00Z",
      score: 2150,
      aspects: { ethics: -0.9, fork: 0.95 },
    },
    {
      postId: "hn_c1",
      parentId: "hn_root",
      author: "cloud_hacker",
      text: "AWS and Google contributed huge patches. They aren't going to roll over; they will sponsor the fork, maintain it, and the commercial entity will lose its primary pipeline of talent.",
      timestamp: "2024-03-22T08:30:00Z",
      score: 930,
      aspects: { economics: -0.75, competition: 0.8 },
    },
  ],
};

export const TWITTER_BACKLASH_THREAD: DiscourseThread = {
  platform: "twitter",
  threadId: "tw_1701625487",
  title: "Runtime Fee Announcement Post",
  author: "UnityOfficial",
  url: "https://twitter.com/UnityOfficial/status/1701625487",
  timestamp: "2023-09-12T13:00:00Z",
  metrics: { upvotes: 2100, comments: 14500, shares: 9800 }, // Massive Ratio: 14500 replies + 9800 quotes vs 2100 likes
  posts: [
    {
      postId: "tw_root",
      author: "UnityOfficial",
      text: "We are introducing the Unity Runtime Fee. Games meeting revenue and install metrics will pay a small fee per install starting Jan 2024.",
      timestamp: "2023-09-12T13:00:00Z",
      score: -0.6,
      aspects: { pricing: -0.8 },
    },
    {
      postId: "tw_ratio_quote",
      parentId: "tw_root",
      author: "gamedev_kol",
      text: "Getting ratio'd into oblivion. A per-install fee is mathematically catastrophic for indie developers and impossible to track cleanly. Migrating our next title to Godot immediately. #BoycottUnity",
      timestamp: "2023-09-12T13:15:00Z",
      score: -0.95,
      aspects: { ratio: 0.95, migration: 0.9, trust: -1.0 },
    },
  ],
};

export const GITHUB_ISSUES_THREAD: DiscourseThread = {
  platform: "github",
  threadId: "gh_docker_sunset_issue_4821",
  title: "Free Team organization deletion policy violates repository continuity",
  author: "oss_maintainer_alex",
  url: "https://github.com/docker/hub-feedback/issues/4821",
  timestamp: "2023-03-15T10:00:00Z",
  metrics: { upvotes: 3400, comments: 280 },
  posts: [
    {
      postId: "gh_root",
      author: "oss_maintainer_alex",
      text: "If you delete our free team org, anyone can claim our namespace and push trojaned images to millions of existing docker pull commands in production.",
      timestamp: "2023-03-15T10:00:00Z",
      score: 3400,
      aspects: { security: -1.0, supply_chain: -0.95 },
    },
  ],
};
