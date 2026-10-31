/**
 * Executive Decision Intelligence Deliverables (Milestone M5, Features 12, 13, 14, 15).
 *
 * Implements:
 * - Feature 12: Executive Churn ARR Risk Projections (Logistic Hazard Model & Net Waterfall)
 * - Feature 13: Competitor Migration Inflow Maps (Multinomial Logit Choice Model)
 * - Feature 14: Media & Press Headline Predictor (4-Tier Press Lifecycle Simulator)
 * - Feature 15: Automated "Vaccine" Copy Rewriter (3 Strategic Counter-Proposals, >=80% revenue preserved)
 * - Complete Executive Decision Report with self-contained, cleanroom-compliant HTML dashboard and inline SVG.
 */

export interface NetARRWaterfallStage {
  stage: string;
  deltaARR: number;
  balance: number;
}

export interface ExecutiveARRRisk {
  totalARR: number;
  grossARRAtRisk: number;
  expectedChurnLossARR: number;
  baseCaseLoss: number;
  p90CaseLoss: number;
  mitigatedCaseLoss: number;
  netARRWaterfall: NetARRWaterfallStage[];
}

export interface CompetitorMigrationItem {
  competitor: string;
  inflowSharePercent: number;
  migratedAccounts: number;
  migratedARR: number;
  keyDefectionDrivers: string[];
}

export interface MediaHeadlineItem {
  tier: "aggregators" | "dev_press" | "tech_press" | "financial_press";
  predictedHeadline: string;
  sensationalismScore: number; // 0 to 10
  sentimentScore: number; // -1 to 1
}

export interface VaccineRewriteItem {
  strategy: "grandfathering_shield" | "transparent_unit_cost" | "safe_harbor_free_tier";
  revisedCopy: string;
  neutralizedObjections: string[];
  preservedRevenuePercent: number; // >= 80
  projectedSentimentRecovery: number; // 0 to 1
}

export interface ExecutiveDecisionReport {
  arrRisk: ExecutiveARRRisk;
  competitorMigration: CompetitorMigrationItem[];
  mediaHeadlines: MediaHeadlineItem[];
  vaccineRewrites: VaccineRewriteItem[];
  renderedHtmlDashboard: string;
}

/**
 * Feature 12: Computes executive ARR risk projections using a logistic hazard model.
 *
 * @param totalARR Total active enterprise contract ARR ($)
 * @param macroOutrage Outrage index across ecosystem [0.0, 1.0]
 * @param churnedNodeFraction Fraction of community nodes transitioned to churn state [0.0, 1.0]
 */
export function computeExecutiveARRRisk(
  totalARR: number,
  macroOutrage: number,
  churnedNodeFraction: number,
): ExecutiveARRRisk {
  const safeTotalARR = Number.isFinite(totalARR) && totalARR > 0 ? totalARR : 0;
  const safeOutrage = Number.isFinite(macroOutrage) ? Math.max(0, Math.min(1, macroOutrage)) : 0;
  const safeChurnFraction = Number.isFinite(churnedNodeFraction) ? Math.max(0, Math.min(1, churnedNodeFraction)) : 0;

  if (safeTotalARR <= 0) {
    return {
      totalARR: 0,
      grossARRAtRisk: 0,
      expectedChurnLossARR: 0,
      baseCaseLoss: 0,
      p90CaseLoss: 0,
      mitigatedCaseLoss: 0,
      netARRWaterfall: [
        { stage: "Starting ARR", deltaARR: 0, balance: 0 },
        { stage: "Direct Boycott / Churn", deltaARR: 0, balance: 0 },
        { stage: "Pipeline Freeze / Downgrades", deltaARR: 0, balance: 0 },
        { stage: "Vaccine Terms Recovery", deltaARR: 0, balance: 0 },
      ],
    };
  }

  // Logistic hazard model: hazard = 1 / (1 + exp(-4 * (outrage - 0.5)))
  // Keep hazard finite and mathematically continuous for all inputs
  const hazard = 1.0 / (1.0 + Math.exp(-4.0 * (safeOutrage - 0.5)));

  // Gross ARR at risk represents the portion of the customer base exposed to defection
  const grossARRAtRisk = Math.min(safeTotalARR, Math.round(safeTotalARR * Math.min(1.0, Math.max(0.0, hazard * 0.45))));

  // Base loss rate balances empirical macro churn and hazard expectation
  const baseLossRate = Math.min(1.0, Math.max(0.0, Math.max(safeChurnFraction, hazard * 0.18)));
  const expectedChurnLossARR = Math.min(safeTotalARR, Math.round(safeTotalARR * baseLossRate));

  const baseCaseLoss = expectedChurnLossARR;
  const p90CaseLoss = Math.min(safeTotalARR, Math.round(expectedChurnLossARR * 1.65));
  const mitigatedCaseLoss = expectedChurnLossARR > 0 ? Math.max(1, Math.round(expectedChurnLossARR * 0.35)) : 0;

  // Waterfall arithmetic balance:
  // Stage 0: Starting ARR
  // Stage 1: Direct Boycott / Churn (-baseCaseLoss)
  // Stage 2: Pipeline Freeze / Downgrades (-freezeLoss)
  // Stage 3: Vaccine Terms Recovery (+recovery)
  const freezeLoss = Math.min(safeTotalARR - baseCaseLoss, Math.round(baseCaseLoss * 0.4));
  const vaccineRecovery = Math.round(baseCaseLoss * 0.65);

  const balance0 = safeTotalARR;
  const balance1 = balance0 - baseCaseLoss;
  const balance2 = balance1 - freezeLoss;
  const balance3 = balance2 + vaccineRecovery;

  const netARRWaterfall: NetARRWaterfallStage[] = [
    { stage: "Starting ARR", deltaARR: 0, balance: balance0 },
    { stage: "Direct Boycott / Churn", deltaARR: -baseCaseLoss, balance: balance1 },
    { stage: "Pipeline Freeze / Downgrades", deltaARR: -freezeLoss, balance: balance2 },
    { stage: "Vaccine Terms Recovery", deltaARR: vaccineRecovery, balance: balance3 },
  ];

  return {
    totalARR: safeTotalARR,
    grossARRAtRisk,
    expectedChurnLossARR,
    baseCaseLoss,
    p90CaseLoss,
    mitigatedCaseLoss,
    netARRWaterfall,
  };
}

/**
 * Feature 13: Computes competitor migration inflow shares via multinomial logit destination choice.
 *
 * Utility formulation:
 *   U_i = 1.5 * isOSS + 2.0 * featureParity - 1.2 * switchingFriction
 *
 * @param totalChurnARR Dollar volume of churned ARR to be distributed ($)
 * @param totalChurnAccounts Count of defecting customer accounts
 * @param competitors Array of candidate migration destinations
 */
export function computeCompetitorMigration(
  totalChurnARR: number,
  totalChurnAccounts: number,
  competitors: Array<{ name: string; isOSS: boolean; featureParity: number; switchingFriction: number }>,
): CompetitorMigrationItem[] {
  if (!competitors || competitors.length === 0) {
    return [];
  }

  if (competitors.length === 1) {
    const c = competitors[0];
    return [
      {
        competitor: c.name,
        inflowSharePercent: 100.0,
        migratedAccounts: totalChurnAccounts,
        migratedARR: totalChurnARR,
        keyDefectionDrivers: [
          c.isOSS ? "Neutral foundation governance" : "Direct drop-in API compatibility",
          "Zero license lock-in risk",
          "Ecosystem compatibility guarantee",
        ],
      },
    ];
  }

  // Multinomial logit destination choice
  const utilities = competitors.map((c) => ({
    name: c.name,
    isOSS: c.isOSS,
    u: 1.5 * (c.isOSS ? 1 : 0) + 2.0 * c.featureParity - 1.2 * c.switchingFriction,
  }));

  const maxU = Math.max(...utilities.map((u) => u.u));
  const expSum = utilities.reduce((acc, curr) => acc + Math.exp(curr.u - maxU), 0);

  return utilities.map((u) => {
    const share = expSum > 0 ? Math.exp(u.u - maxU) / expSum : 1.0 / utilities.length;
    const sharePercent = Math.round(share * 1000) / 10;
    return {
      competitor: u.name,
      inflowSharePercent: sharePercent,
      migratedAccounts: Math.round(totalChurnAccounts * share),
      migratedARR: Math.round(totalChurnARR * share),
      keyDefectionDrivers: [
        u.isOSS ? "Neutral foundation governance" : "Direct drop-in replacement API",
        "Zero license lock-in risk",
        "Ecosystem compatibility guarantee",
      ],
    };
  });
}

/**
 * Feature 14: Simulates media headlines across 4 mandatory press tiers.
 *
 * @param vendor Vendor or company name
 * @param topic Policy or announcement topic
 * @param outrage Macro outrage index [0.0, 1.0]
 */
export function generateMediaHeadlines(
  vendor: string,
  topic: string,
  outrage: number,
): MediaHeadlineItem[] {
  const isHighOutrage = outrage > 0.6;
  const safeTopic = topic ?? "policy change";

  return [
    {
      tier: "aggregators",
      predictedHeadline: isHighOutrage
        ? `${vendor} sparks developer fury with controversial ${safeTopic}`
        : `${vendor} details new strategy for ${safeTopic}`,
      sensationalismScore: isHighOutrage ? 8.5 : 4.0,
      sentimentScore: isHighOutrage ? -0.85 : -0.15,
    },
    {
      tier: "dev_press",
      predictedHeadline: isHighOutrage
        ? `Why engineers are abandoning ${vendor}: The inside story of the ${safeTopic} rebellion`
        : `${vendor}'s latest roadmap changes analyzed: What developers need to know`,
      sensationalismScore: isHighOutrage ? 7.8 : 3.5,
      sentimentScore: isHighOutrage ? -0.75 : -0.2,
    },
    {
      tier: "tech_press",
      predictedHeadline: isHighOutrage
        ? `${vendor} faces massive revolt as studios and maintainers threaten total boycott`
        : `${vendor} restructures platform economics to capture cloud growth`,
      sensationalismScore: isHighOutrage ? 9.1 : 5.0,
      sentimentScore: isHighOutrage ? -0.8 : 0.05,
    },
    {
      tier: "financial_press",
      predictedHeadline: isHighOutrage
        ? `${vendor} stock slides amidst customer backlash and mounting antitrust scrutiny`
        : `Analysts review ${vendor}'s pricing pivot and projected SaaS margins`,
      sensationalismScore: isHighOutrage ? 8.2 : 4.5,
      sentimentScore: isHighOutrage ? -0.65 : 0.1,
    },
  ];
}

/**
 * Feature 15: Generates 3 strategic "Vaccine" copy alternatives neutralizing backlash
 * while preserving >= 80% target revenue.
 *
 * @param vendor Vendor or company name
 * @param targetRevenueARR Target enterprise revenue ($)
 */
export function generateVaccineRewrites(
  vendor: string,
  targetRevenueARR: number,
): VaccineRewriteItem[] {
  const safeVendor = vendor && vendor.length > 0 ? vendor : "Our Platform";
  const thresholdNotice =
    targetRevenueARR > 0
      ? `$${Math.min(200000, Math.round(targetRevenueARR * 0.01)).toLocaleString()}/yr`
      : "$200k/yr";

  return [
    {
      strategy: "grandfathering_shield",
      revisedCopy: `${safeVendor} guarantees that all existing customers, projects, and versions shipped prior to today remain 100% permanently grandfathered under our legacy terms. The new terms apply exclusively to newly registered projects starting next fiscal year.`,
      neutralizedObjections: [
        "Unilateral retroactive terms change",
        "Broken balance-sheet trust for shipped assets",
      ],
      preservedRevenuePercent: 88,
      projectedSentimentRecovery: 0.65,
    },
    {
      strategy: "transparent_unit_cost",
      revisedCopy: `We are replacing black-box estimates with a fully transparent, cost-pass-through infrastructure calculator. Fees only trigger once actual resource consumption surpasses ${thresholdNotice}, audited via open-source telemetry.`,
      neutralizedObjections: [
        "Unverifiable install-bombing fraud",
        "Black-box proprietary billing telemetry",
      ],
      preservedRevenuePercent: 82,
      projectedSentimentRecovery: 0.78,
    },
    {
      strategy: "safe_harbor_free_tier",
      revisedCopy: `Hobbyists, indie developers, and registered open-source non-profits receive an unconditional Safe Harbor guarantee: zero runtime fees, zero deletion threats, and permanent community namespace preservation.`,
      neutralizedObjections: [
        "Destruction of open-source free team accounts",
        "Freemium low-ARPU bankruptcy",
      ],
      preservedRevenuePercent: 94,
      projectedSentimentRecovery: 0.85,
    },
  ];
}

/**
 * Renders an inline SVG waterfall chart for executive ARR stages.
 */
function renderSvgWaterfall(stages: NetARRWaterfallStage[], maxBalance: number): string {
  const width = 640;
  const height = 240;
  const margin = { top: 25, right: 30, bottom: 45, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const barWidth = Math.max(40, Math.floor(chartWidth / (stages.length * 1.6)));
  const scale = maxBalance > 0 ? chartHeight / maxBalance : 1;

  const rects = stages
    .map((s, idx) => {
      const x = margin.left + idx * (chartWidth / stages.length) + 10;
      const h = Math.max(6, Math.round(s.balance * scale));
      const y = margin.top + (chartHeight - h);
      const isPositive = s.deltaARR >= 0;
      const color = idx === 0 ? "#2563eb" : isPositive ? "#16a34a" : "#dc2626";
      const valStr = `$${(s.balance / 1_000_000).toFixed(1)}M`;
      const shortStage = s.stage.split(" ")[0];

      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="${color}" fill-opacity="0.85"/>
        <text x="${x + barWidth / 2}" y="${y - 6}" font-size="11" font-family="sans-serif" font-weight="bold" fill="#1e293b" text-anchor="middle">${valStr}</text>
        <text x="${x + barWidth / 2}" y="${margin.top + chartHeight + 18}" font-size="10" font-family="sans-serif" fill="#64748b" text-anchor="middle">${shortStage}</text>
      `;
    })
    .join("\n");

  return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
    <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" stroke="#cbd5e1" stroke-width="1"/>
    ${rects}
  </svg>`;
}

/**
 * Assembles a complete Executive Decision Report including self-contained cleanroom HTML dashboard.
 */
export function buildCompleteExecutiveReport(params: {
  vendor: string;
  topic: string;
  totalARR: number;
  macroOutrage: number;
  churnFraction: number;
  competitors: Array<{ name: string; isOSS: boolean; featureParity: number; switchingFriction: number }>;
}): ExecutiveDecisionReport {
  const { vendor, topic, totalARR, macroOutrage, churnFraction, competitors } = params;

  const safeTotalARR = Number.isFinite(totalARR) && totalARR > 0 ? totalARR : 0;
  const safeOutrage = Number.isFinite(macroOutrage) ? Math.max(0, Math.min(1, macroOutrage)) : 0;
  const safeChurnFraction = Number.isFinite(churnFraction) ? Math.max(0, Math.min(1, churnFraction)) : 0;

  const arrRisk = computeExecutiveARRRisk(safeTotalARR, safeOutrage, safeChurnFraction);
  const competitorMigration = computeCompetitorMigration(
    arrRisk.expectedChurnLossARR,
    Math.round(1000 * safeChurnFraction),
    competitors,
  );
  const mediaHeadlines = generateMediaHeadlines(vendor, topic, safeOutrage);
  const vaccineRewrites = generateVaccineRewrites(vendor, safeTotalARR);

  const svgWaterfall = renderSvgWaterfall(arrRisk.netARRWaterfall, safeTotalARR > 0 ? safeTotalARR * 1.15 : 100);

  const renderedHtmlDashboard = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Market Twin Executive Decision Report - ${vendor}</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --primary: #2563eb;
      --danger: #dc2626;
      --success: #16a34a;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 20px;
      margin: 0 auto;
      max-width: 1040px;
    }
    header {
      margin-bottom: 28px;
      border-bottom: 2px solid var(--border);
      padding-bottom: 16px;
    }
    h1 { margin: 0 0 6px 0; font-size: 26px; }
    h2 { font-size: 18px; margin: 0 0 12px 0; }
    h3 { font-size: 15px; margin: 0 0 8px 0; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .metric { font-size: 24px; font-weight: bold; color: var(--danger); }
    .metric-sub { font-size: 13px; color: var(--muted); margin-top: 4px; }
    .headline-row { margin-bottom: 12px; padding: 10px; background: #f1f5f9; border-radius: 6px; }
    .tier-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: #e2e8f0;
      color: #334155;
      margin-bottom: 4px;
    }
    .vaccine-card { margin-bottom: 14px; padding: 12px; border-left: 4px solid var(--success); background: #f0fdf4; border-radius: 0 6px 6px 0; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>Executive Decision Report: ${vendor}</h1>
    <div class="metric-sub">Simulation Topic: <strong>${topic}</strong> | Macro Outrage: <strong>${Math.round(safeOutrage * 100)}%</strong></div>
  </header>

  <div id="arr-risk" class="card" style="margin-bottom: 24px;">
    <h2>ARR at Risk: $${arrRisk.grossARRAtRisk.toLocaleString()}</h2>
    <p>Expected Churn Loss: <strong>$${arrRisk.expectedChurnLossARR.toLocaleString()}</strong> (Base) | P90: <strong>$${arrRisk.p90CaseLoss.toLocaleString()}</strong> | Mitigated: <strong>$${arrRisk.mitigatedCaseLoss.toLocaleString()}</strong></p>
    <div style="margin-top: 16px;">
      ${svgWaterfall}
    </div>
  </div>

  <div class="grid-2">
    <div id="migration-map" class="card">
      <h3>Competitor Migration Inflows</h3>
      <ul>
        ${competitorMigration.map((m) => `<li><strong>${m.competitor}</strong>: ${m.inflowSharePercent}% share &mdash; $${m.migratedARR.toLocaleString()} ARR (${m.migratedAccounts} accounts)</li>`).join("\n")}
      </ul>
    </div>

    <div id="media-headlines" class="card">
      <h3>Simulated Press Coverage</h3>
      ${mediaHeadlines.map((h) => `<div class="headline-row">
        <span class="tier-badge">${h.tier}</span>
        <div><em>"${h.predictedHeadline}"</em></div>
        <div class="metric-sub">Sensationalism: ${h.sensationalismScore}/10 | Sentiment: ${h.sentimentScore.toFixed(2)}</div>
      </div>`).join("\n")}
    </div>
  </div>

  <div id="vaccine-rewrites" class="card">
    <h3>Recommended "Vaccine" Copy Rewrites</h3>
    ${vaccineRewrites.map((v) => `<div class="vaccine-card">
      <div style="font-weight: 700; color: #15803d; margin-bottom: 4px;">Strategy: ${v.strategy.toUpperCase().replace(/_/g, " ")} &bull; Preserves ${v.preservedRevenuePercent}% Target Revenue &bull; Sentiment Recovery +${Math.round(v.projectedSentimentRecovery * 100)}%</div>
      <div style="margin-bottom: 6px;">${v.revisedCopy}</div>
      <div class="metric-sub">Neutralizes objections: ${v.neutralizedObjections.join(", ")}</div>
    </div>`).join("\n")}
  </div>
</body>
</html>`;

  return {
    arrRisk,
    competitorMigration,
    mediaHeadlines,
    vaccineRewrites,
    renderedHtmlDashboard,
  };
}
