/**
 * Canonical Historical Backlash Corpus types and validation contracts (Feature 5, R1).
 */

export interface HistoricalBacklashCase {
  id: string; // e.g. "unity-runtime-fee-2023"
  title: string;
  vendor: string;
  announcementDate: string;
  policySummary: string;
  objections: Array<{
    category: string;
    severity: number; // 0 to 10
    claim: string;
  }>;
  timeline: Array<{
    stage: "announcement" | "outrage" | "boycott" | "walkback" | "aftermath";
    daysAfterT0: number;
    headline: string;
    sentimentScore: number; // [-1.0, 1.0]
  }>;
  churnImpact: {
    estimatedARRChurnPercent: number;
    primaryMigrationDestinations: Array<{
      competitor: string;
      inflowShare: number;
    }>;
  };
}

export function validateHistoricalBacklashCase(obj: unknown): HistoricalBacklashCase {
  if (!obj || typeof obj !== "object") {
    throw new Error("HistoricalBacklashCase must be an object");
  }
  const c = obj as Partial<HistoricalBacklashCase>;
  if (!c.id || typeof c.id !== "string") {
    throw new Error("Missing case id");
  }
  if (!c.title || typeof c.title !== "string") {
    throw new Error("Missing title");
  }
  if (!c.vendor || typeof c.vendor !== "string") {
    throw new Error("Missing vendor");
  }
  if (!c.announcementDate || typeof c.announcementDate !== "string") {
    throw new Error("Missing announcementDate");
  }
  if (!c.policySummary || typeof c.policySummary !== "string") {
    throw new Error("Missing policySummary");
  }
  if (!Array.isArray(c.objections) || c.objections.length === 0) {
    throw new Error("Must have objections");
  }
  for (const objItem of c.objections) {
    if (!objItem.category || typeof objItem.category !== "string") {
      throw new Error("Missing objection category");
    }
    if (typeof objItem.severity !== "number" || objItem.severity < 0 || objItem.severity > 10) {
      throw new Error(`Invalid severity: ${objItem.severity}`);
    }
    if (!objItem.claim || typeof objItem.claim !== "string") {
      throw new Error("Missing objection claim");
    }
  }
  if (!Array.isArray(c.timeline) || c.timeline.length === 0) {
    throw new Error("Must have timeline");
  }
  for (const tl of c.timeline) {
    if (!["announcement", "outrage", "boycott", "walkback", "aftermath"].includes(tl.stage)) {
      throw new Error(`Invalid stage: ${tl.stage}`);
    }
    if (typeof tl.daysAfterT0 !== "number") {
      throw new Error("Invalid daysAfterT0");
    }
    if (!tl.headline || typeof tl.headline !== "string") {
      throw new Error("Invalid headline");
    }
    if (typeof tl.sentimentScore !== "number" || tl.sentimentScore < -1 || tl.sentimentScore > 1) {
      throw new Error(`Invalid sentimentScore: ${tl.sentimentScore}`);
    }
  }
  if (!c.churnImpact || typeof c.churnImpact.estimatedARRChurnPercent !== "number") {
    throw new Error("Invalid churnImpact");
  }
  if (!Array.isArray(c.churnImpact.primaryMigrationDestinations)) {
    throw new Error("Invalid primaryMigrationDestinations");
  }
  return c as HistoricalBacklashCase;
}
