/**
 * @murmur/templates — scenario packs. Pre-structured research briefs users
 * can fill in and attach as seeds, each with suggested simulation settings.
 * Listed via `murmur-mcp templates`; copied via `murmur-mcp init --template X`.
 */

export interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  suggested: { rounds: number; personas: number; focus: string };
  markdown: string;
}

function brief(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([h, body]) => `## ${h}\n\n${body}\n`)
    .join("\n");
}

export const SCENARIOS: ScenarioTemplate[] = [
  {
    id: "launch",
    title: "Product launch reaction",
    description: "Predict how developer and user communities react to a launch: pricing, positioning, migration friction, competitor response.",
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
    description: "Simulate stakeholder reaction to a policy change: API terms, moderation rules, licensing, data usage, return-to-office.",
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
    description: "War-game an outage, breach or recall: what the community says, which threads escalate, what statement lands.",
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
    description: "Simulate investor and analyst chatter after an earnings print, guidance change or product finance event.",
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
    description: "Run a fictional population of readers/fans reacting to a story beat, twist or canon change — a zero-cost test audience.",
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
