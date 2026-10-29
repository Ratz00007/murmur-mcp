/**
 * Historical Backlash Corpus Subsystem (Feature 5, R1)
 */

export * from "./types.js";
export * from "./unity.js";
export * from "./docker.js";
export * from "./redis-hashicorp.js";

import type { HistoricalBacklashCase } from "./types.js";
import { UNITY_2023_CASE } from "./unity.js";
import { DOCKER_HUB_2023_CASE } from "./docker.js";
import { REDIS_2024_CASE, HASHICORP_2023_CASE } from "./redis-hashicorp.js";

export const CANONICAL_HISTORICAL_CASES: readonly HistoricalBacklashCase[] = [
  UNITY_2023_CASE,
  DOCKER_HUB_2023_CASE,
  REDIS_2024_CASE,
  HASHICORP_2023_CASE,
] as const;

export function listHistoricalCases(): HistoricalBacklashCase[] {
  return [...CANONICAL_HISTORICAL_CASES];
}

export function getHistoricalCase(idOrName: string): HistoricalBacklashCase | undefined {
  if (!idOrName) return undefined;
  const target = idOrName.toLowerCase().trim();
  return CANONICAL_HISTORICAL_CASES.find((c) => {
    const id = c.id.toLowerCase();
    const vendor = c.vendor.toLowerCase();
    const title = c.title.toLowerCase();
    const dests = c.churnImpact.primaryMigrationDestinations.map((d) => d.competitor.toLowerCase());
    return (
      id === target ||
      id.includes(target) ||
      target.includes(id) ||
      vendor.includes(target) ||
      title.includes(target) ||
      dests.some((d) => d.includes(target) || target.includes(d))
    );
  });
}
