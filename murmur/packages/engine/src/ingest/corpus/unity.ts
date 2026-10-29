/**
 * Canonical Historical Case: Unity Runtime Fee (September 2023)
 * Feature 5, R1
 */

import type { HistoricalBacklashCase } from "./types.js";

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
