/**
 * Canonical Historical Cases: Redis (2024) and HashiCorp (2023) Licensing Pivots
 * Feature 5, R1
 */

import type { HistoricalBacklashCase } from "./types.js";

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
