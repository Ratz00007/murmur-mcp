/**
 * Canonical Historical Case: Docker Hub Free Team Deprecation (March 2023)
 * Feature 5, R1
 */

import type { HistoricalBacklashCase } from "./types.js";

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
    {
      stage: "aftermath",
      daysAfterT0: 45,
      headline: "Docker CEO reaffirms commitment to open source community and non-profit tiers",
      sentimentScore: 0.05,
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
