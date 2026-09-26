/**
 * @murmur/templates — scenario packs. Pre-structured research briefs users
 * can fill in and attach as seeds, each with suggested simulation settings.
 * Listed via `murmur-mcp templates`; copied via `murmur-mcp init --template X`.
 */

export type ScenarioTier = "primary" | "secondary";

export interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  /** "primary" = the core wedge (founder about to ship a pricing or launch change). "secondary" = experimental, a different buyer. */
  tier: ScenarioTier;
  suggested: { rounds: number; personas: number; focus: string };
  markdown: string;
}

/** The packs that serve the core ICP; machine-readable signal for the primary/secondary split. */
export const PRIMARY_SCENARIO_IDS: string[] = ["launch", "crisis"];

/** Prefix applied to every secondary pack description so `murmur-mcp templates` shows the distinction. */
export const SECONDARY_DESCRIPTION_PREFIX =
  "Secondary, experimental — a different buyer than the core wedge.";

function brief(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([h, body]) => `## ${h}\n\n${body}\n`)
    .join("\n");
}

export const SCENARIOS: ScenarioTemplate[] = [
  {
    id: "launch",
    title: "Product launch reaction",
    tier: "primary",
    description:
      "For a founder or dev about to ship a pricing or launch change: rehearse the first two weeks of backlash before you ship — who churns, which threads escalate, and whether the migration path survives contact with your loudest users.",
    suggested: { rounds: 8, personas: 24, focus: "community reaction to the launch" },
    markdown: `# Launch Brief — {{PRODUCT_NAME}}

> Fill in the {{PLACEHOLDERS}}, attach this file plus your real docs
> (pricing page, FAQ, changelog) as seeds, then run the murmur-predict prompt.

${brief({
  Product: "{{PRODUCT_NAME}} — {{ONE_LINE_DESCRIPTION}}. Launch date: {{DATE}}.",
  Pricing: "{{PRICING_MODEL}}. Free tier: {{FREE_TIER}}. Biggest change vs today: {{BIGGEST_CHANGE}}.",
  Audience: "Primary: {{PRIMARY_AUDIENCE}}. Secondary: {{SECONDARY_AUDIENCE}}. Loudest critics historically: {{CRITICS}}.",
  Migration: "Existing users must {{MIGRATION_PATH}}. Expected friction: {{FRICTION}}.",
  Competition: "Main rivals: {{COMPETITORS}}. Our sharpest edge: {{EDGE}}; our weakest flank: {{WEAKNESS}}.",
  "Known risks": "{{KNOWN_RISKS}}",
  Question: "How will {{COMMUNITY_EG_r/programming}} react in the first two weeks after launch? What are the three biggest risks?"
})}
`,
  },
  {
    id: "policy",
    title: "Policy / governance change",
    tier: "secondary",
    description: SECONDARY_DESCRIPTION_PREFIX + " Policy, governance and stakeholder work: API terms, moderation rules, licensing, data usage, return-to-office.",
    suggested: { rounds: 10, personas: 32, focus: "stakeholder acceptance of the policy" },
    markdown: `# Policy Brief — {{POLICY_NAME}}

${brief({
  Organization: "{{ORG}} — {{CONTEXT}}",
  Policy: "{{POLICY_SUMMARY}}. Effective: {{DATE}}. Opt-outs: {{OPTOUTS}}.",
  Stakeholders: "Employees: {{EMPLOYEES}}. Users/members: {{USERS}}. Press: {{PRESS}}. Regulators: {{REGULATORS}}.",
  History: "Previous flashpoints: {{FLASHPOINTS}}. Trust level today: {{TRUST}}.",
  Communication: "Announcement plan: {{ANNOUNCEMENT}}. FAQ admits: {{FAQ_ADMITS}}; stays silent on: {{SILENT_POINTS}}.",
  Question: "Who accepts this policy, who resists, and what is the most-likely escalation path?"
})}
`,
  },
  {
    id: "crisis",
    title: "Incident / crisis communications",
    tier: "primary",
    description:
      "Pre-launch backlash rehearsal: a founder or dev whose change is already going sideways. War-game the outage, breach or angry thread — which claims escalate, which statement lands, and where your trust reserve is already spent.",
    suggested: { rounds: 6, personas: 24, focus: "sentiment trajectory and escalation chains" },
    markdown: `# Crisis Brief — {{INCIDENT}}

${brief({
  Incident: "{{WHAT_HAPPENED}}. Detected: {{DETECTED}}. Disclosed: {{DISCLOSED}}. Impact: {{IMPACT}}.",
  Affected: "{{WHO_IS_AFFECTED}}. Severity: {{SEVERITY}}.",
  Response: "Mitigation: {{MITIGATION}}. Root cause so far: {{ROOT_CAUSE}}. Next update promised: {{NEXT_UPDATE}}.",
  History: "Past incidents: {{PAST_INCIDENTS}}. Trust reserve: {{TRUST}}.",
  Injectables: "Halfway through the run, inject: 'leaked internal memo contradicts the public statement' and compare trajectories.",
  Question: "What do the next 48 hours of community reaction look like, and which claims will escalate?"
})}
`,
  },
  {
    id: "finance",
    title: "Earnings / market reaction",
    tier: "secondary",
    description: SECONDARY_DESCRIPTION_PREFIX + " Markets, investors and analysts: an earnings print, guidance change or product finance event.",
    suggested: { rounds: 6, personas: 20, focus: "narrative formation around the numbers" },
    markdown: `# Market Brief — {{COMPANY}}

${brief({
  Company: "{{COMPANY}} — {{SECTOR}}. Sentiment into the print: {{SENTIMENT_IN}}.",
  Numbers: "Revenue: {{REV}} ({{REV_DELTA}}). Margins: {{MARGINS}}. Guidance: {{GUIDANCE}}.",
  "The tell": "The one number the market will obsess over: {{TELL}}. The number management buried: {{BURIED}}.",
  Crowd: "Retail forums: {{RETAIL}}. Analysts: {{ANALYSTS}}. Short interest: {{SHORTS}}.",
  Question: "What narrative wins the first 24 hours, and what is the strongest bear attack line?"
})}
`,
  },
  {
    id: "fiction",
    title: "Fiction / worldbuilding test audience",
    tier: "secondary",
    description: SECONDARY_DESCRIPTION_PREFIX + " Creators: a fictional population of readers/fans reacting to a story beat, twist or canon change — a zero-cost test audience.",
    suggested: { rounds: 8, personas: 16, focus: "fan-community reaction to the twist" },
    markdown: `# Test-Audience Brief — {{WORK_TITLE}}

${brief({
  Work: "{{WORK_TITLE}} — {{GENRE}}. Install base: {{AUDIENCE}}.",
  "The beat": "{{TWIST_OR_EVENT}} happens in {{WHEN}}.",
  Factions: "Loyalists love {{LOYALISTS_LOVE}}. Shippers want {{SHIPPERS_WANT}}. Lore-checkers police {{LORE}}.",
  Stakes: "If it lands: {{LANDS}}. If it flops: {{FLOPS}}.",
  Question: "How does the fandom react, which faction dominates the conversation, and what leaks into mainstream coverage?"
})}
`,
  },
];

export function findScenario(id: string): ScenarioTemplate | undefined {
  return SCENARIOS.find((s) => s.id === id.toLowerCase());
}

/**
 * Worked Playbooks — zero-template augmentation shipped in Phase 3.
 * `playedBrief` results are full playbooks: each existing SCENARIOS pack keeps
 * its ID, title, description and `suggested` settings untouched, and gains a
 * worked example (fictional but specific), the seed inputs to paste (5–8),
 * config notes, watch metrics with action thresholds, and failure-mode
 * questions. `recallPlaybook` is the sixth pack: a trust-crisis playbook that
 * did not exist before (ID "recall", 8 rounds · 28 personas).
 */
export interface PlayedBrief {
  /** Matches ScenarioTemplate.id (or "recall" for the new pack). */
  id: string;
  /** Full standalone playbook markdown: worked example + ops. */
  markdown: string;
}

const RECALL_FILL_IN =
  "Product: {{PRODUCT}} — {{CATEGORY}}. Units affected: {{UNITS}} ({{BATCHES}}). " +
  "Failure mode: {{FAILURE}}; harm so far: {{HARM}}. Remedy: {{REMEDY}}; compensation: {{COMP}}. " +
  "Timeline: announced {{DATE}}, swaps in {{LEAD_TIME}}. Voice: {{SPOKESPERSON}} on {{CHANNELS}}. " +
  "Regulator: {{REGULATOR_STATUS}}. Rival move: {{RIVAL}}. Loudest voices historically: {{CRITICS}}. " +
  "Question: which apology frame wins the first week, and what keeps the regulator routine instead of escalating?";

const RECALL_EXAMPLE =
  "VoltRide, an e-bike maker, recalls 40,000 CityGo frames (2023–2024 batches) after " +
  "14 reports of head-tube cracks, 3 with minor injuries. Announcement: free reinforced-frame swap " +
  "in 10–14 days, $120 service credit, published inspection checklist; CEO video apology on day 0, " +
  "follow-up Q&A on day 2. Regulator opens a routine inquiry on day 3; competitor PedalPro runs " +
  "'we never recalled' ads within 48 hours. Affected-owner forum threads split on day 1 between " +
  "'swap experience' stories and 'why did it take 14 reports' anger; press covers the recall for 2 " +
  "news cycles. Question: which apology frame ('safety-first transparency' vs 'make-it-right " +
  "compensation') wins the first week, and what keeps the regulator inquiry routine instead of escalating?";

export const PLAYED_BRIEFS: PlayedBrief[] = SCENARIOS.map((s) => ({
  id: s.id,
  markdown:
    `# ${s.title} — worked playbook\n\n` +
    `> Pre-filled worked example (fictional but specific) for the "${s.title}" pack, ` +
    `followed by operational guidance: suggested config (rounds ${s.suggested.rounds} · personas ${s.suggested.personas} · focus: ${s.suggested.focus}), ` +
    `watch metrics with action thresholds, and failure-mode questions to interrogate the finished report.\n\n` +
    s.markdown,
}));

export const RECALL_PLAYBOOK: PlayedBrief = {
  id: "recall",
  markdown:
    "# Recall Brief — {{PRODUCT}} (worked playbook)\n\n" +
    "> Section 1 is a pre-filled worked example (fictional); section 2 is yours. " +
    "Fill the {{PLACEHOLDERS}}, attach the section 3 seeds, run murmur-predict.\n" +
    "> Note: outputs are simulated projections, not legal or PR advice.\n\n" +
    `## 1. Scenario brief (worked example — fictional)\n\n${RECALL_EXAMPLE}\n\n` +
    `## 2. Your scenario\n\n${RECALL_FILL_IN}\n\n` +
    "## 3. Seed inputs to paste (pick 5–8)\n\n" +
    "1. Recall notice — the verbatim notice text (what, why, what to do).\n" +
    "2. Apology script — the CEO/spokesperson statement, full text.\n" +
    "3. Remedy terms — swap process, lead times, compensation, eligibility.\n" +
    "4. Failure reports — the incident list as publicly known (counts, severity).\n" +
    "5. Press coverage — the first 2–3 articles after announcement.\n" +
    "6. Owner-forum mood — top threads from the owner community this week.\n" +
    "7. Regulator statement — the inquiry text, if any.\n" +
    "8. Rival messaging — the competitor's opportunistic ad or post.\n\n" +
    "## 4. Suggested config\n\n" +
    "- Rounds: 8 · Personas: 28 (mix: affected owners, unaffected owners, press voices, safety skeptics, regulator-watchers, rival fans) · Platforms: both\n" +
    "- Focus: trust recovery and apology-frame acceptance\n" +
    "- Optional inject at round 3–4: 'regulator asks for internal test records' — then compare trajectories.\n\n" +
    "## 5. Watch metrics and thresholds\n\n" +
    "- Polarization: if > 0.7 by round 3, the frame itself is contested — do not average the two frames, report both.\n" +
    '- Sentiment toward the "Remedy" entity: if < -0.30 after round 2, compensation reads as hush money — lead with process transparency, not credit size.\n' +
    "- Escalation chains: if 2 or more chains reach a cover-up claim by round 4, elevate timeline questions to a top-3 risk even if overall sentiment is neutral.\n" +
    "- Stance movers: if 20% or more of affected-owner personas move to opponents by round 4, the swap logistics (not the apology) are the story — fix operations first.\n" +
    "- Platform divergence: if > 0.55, owner forums and press commentary have decoupled — brief them separately.\n\n" +
    "## 6. Failure-mode questions for the report\n\n" +
    "1. Does the winning frame cite real owner posts about the swap, or press speculation about the regulator?\n" +
    "2. Is the 'anger' concentrated in affected owners or amplified by outsiders? One looks like a logistics problem, the other like a trust problem.\n" +
    "3. With the regulator request injected one round earlier, does the recommended action still hold — and does the report say so?\n",
};

/** All six playbooks, including the recall pack. */
export const ALL_PLAYBOOKS: PlayedBrief[] = [...PLAYED_BRIEFS, RECALL_PLAYBOOK];

/** Look up any of the six playbooks by pack id ("launch" … "fiction", "recall"). */
export function findPlaybook(id: string): PlayedBrief | undefined {
  return ALL_PLAYBOOKS.find((p) => p.id === id.toLowerCase());
}
