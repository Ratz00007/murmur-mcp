/**
 * @murmur/prompts — playbook prompt packs exposed to host agents as MCP
 * prompts. Prompts are playbooks: they tell the host which tools to call in
 * what order. They stay client-portable and can be extended by template
 * packs without server changes.
 */

export interface PromptArg {
  name: string;
  required: boolean;
  description: string;
}

export interface MurmurPrompt {
  name: string;
  title: string;
  description: string;
  args: PromptArg[];
  build(a: Record<string, string>): string;
}

const PIPELINE_RULES = `
Work the pipeline with the murmur tools, in this order, and obey these rules:
1. world_init — create a world (short name). To attach material: files go to seed_add({source:"files", paths}) with repo-relative paths; a URL means YOU fetch the page and pass seed_add({source:"url", url, text}) — the engine never touches the network; pasted notes go to seed_add({source:"text", title, text}). Then seeds_review and show me the digest.
2. ontology({action:"plan"}) → you complete the task → ontology({action:"submit", task_id, result}). If items are rejected, fix only those and resubmit the same task_id.
3. graph({action:"build"}), then graph({action:"export"}). Report the number of relations and top tensions.
4. personas({action:"plan"}) (default 24 personas) → you draft the population → personas({action:"submit", task_id, result}). Then personas({action:"inspect", persona}) on 2-3 personas to sanity-check voice and stances; personas({action:"edit", persona, patch}) if anything feels off.
5. world_config (default 8 rounds), then loop: sim({action:"next_batch"}) → you write every activated persona's actions (stay in character, react to their actual feed, max 3 actions each) → sim({action:"submit", task_id, generations}). Repeat until all rounds complete. If submissions are rejected, fix surgically; only use finalize:true if I ask.
6. report({action:"plan"}) → you draft the narrative from the evidence pack (exactly 3 risks, each citing real post ids) → report({action:"submit", task_id, draft}) → report({action:"export"}).
7. Show me the report path and a 5-line summary of the most-likely trajectory and the three risks.
Notes: never invent post ids or statistics; use only what the tools return. If a tool errors, read its message — every receipt tells you the next step.`;

export const PROMPTS: MurmurPrompt[] = [
  {
    name: "murmur-predict",
    title: "Murmur: Predict",
    description: "Full pipeline in one command: seeds → ontology → graph → personas → simulation → prediction report. Use this when you want the complete answer to a 'how will people react' question.",
    args: [
      { name: "question", required: true, description: "The prediction question, e.g. 'How will r/programming react to the new pricing page?'" },
      { name: "sources", required: false, description: "Where the source material lives: repo files, URLs, or pasted text (if omitted, ask me)" },
    ],
    build: (a) =>
      `I want a social-simulation prediction. Question: ${a.question}\nSources: ${a.sources || "(ask me — I may point you at files in this repo, paste text, or give URLs; fetch URLs yourself and pass the extracted text to seed_add({source:'url'}))"}\n${PIPELINE_RULES}`,
  },
  {
    name: "murmur-simulate",
    title: "Murmur: Simulate (mid-run inspection)",
    description: "Run the pipeline but STOP after N rounds for inspection and god's-eye injection — then continue or report. Use this to experiment with events mid-run.",
    args: [
      { name: "question", required: true, description: "The scenario question" },
      { name: "rounds", required: false, description: "Rounds to run before pausing (default 4)" },
      { name: "sources", required: false, description: "Source material (files / URLs / text)" },
    ],
    build: (a) =>
      `I want a mid-run social simulation. Question: ${a.question}\nSources: ${a.sources || "(ask me)"}\nRun the pipeline as usual (world_init → seeds → ontology → graph → personas → world_config with ${a.rounds || 4}+ total rounds), but PAUSE after round ${a.rounds || 4}:\n` +
      `- Show me sim({action:"timeline"}) and the sentiment per entity so far.\n- Ask me whether to sim({action:"inject"}) (describe a hypothetical event) or continue.\n- On continue: keep looping sim({action:"next_batch"}) → sim({action:"submit"}) to the final round, then report({action:"plan"}) → report({action:"submit"}) → report({action:"export"}) and summarize.\n${PIPELINE_RULES}`,
  },
  {
    name: "murmur-interview",
    title: "Murmur: Interview",
    description: "Open a grounded dialogue with one simulated persona, or with the ReportAgent over the whole run. Use after a report exists.",
    args: [
      { name: "question", required: true, description: "What to ask" },
      { name: "persona", required: false, description: "Persona id/handle; omit to ask the ReportAgent instead" },
    ],
    build: (a) =>
      a.persona
        ? `Interview the simulated persona ${a.persona}. Question: "${a.question}"\nCall interact({target:"persona", persona, question}) → answer strictly from the returned pack, in first person, citing their own post ids, declining what they never saw → call interact again with target:"persona" + persona + question + answer to log it. Then relay the answer to me. If I keep asking follow-ups, repeat this loop.`
        : `Ask the Murmur ReportAgent: "${a.question}"\nCall interact({target:"run", question}) → answer using ONLY the evidence pack, citing post ids like (po_12), separating strong from weak evidence → call interact again with target:"run" + question + answer to log it. Relay the answer to me and repeat for follow-ups.`,
  },
  {
    name: "murmur-resume",
    title: "Murmur: Resume",
    description: "Reopen a saved world at its exact stage boundary and continue where it left off (crash-safe by construction).",
    args: [{ name: "world", required: false, description: "World id/slug; omit to list worlds" }],
    build: (a) =>
      `Resume a Murmur world. ${a.world ? `World: ${a.world}.` : "First call world_list() to see the worlds, then ask which to open."}\nCall world_list({world: <id>, detail:"open"}) (or pick the world), then world_list({detail:"status"}) — it tells you the stage, counts and the exact next tool. Continue the pipeline from there: seeds → ontology → graph → personas → simulation loop → report → interact. Never redo completed stages; every receipt names the next step.`,
  },
];

export function findPrompt(name: string): MurmurPrompt | undefined {
  return PROMPTS.find((p) => p.name === name || p.name === `murmur-${name}`);
}
