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
1. world_init — create a world (short name). If seeds come from files, pass their repo-relative paths to seed_add_files; for URLs, fetch each page yourself and pass url + extracted text to seed_add_url; for pasted notes use seed_add_text. Then seeds_review and show me the digest.
2. ontology_plan → you complete the task → ontology_submit. If items are rejected, fix only those and resubmit the same task_id.
3. graph_build, then graph_export_mermaid. Report the number of relations and top tensions.
4. personas_plan (default 24 personas) → you draft the population → personas_submit. Then persona_inspect on 2-3 personas to sanity-check voice and stances; persona_edit if anything feels off.
5. sim_configure (default 8 rounds), then loop: sim_next_batch → you write every activated persona's actions (stay in character, react to their actual feed, max 3 actions each) → sim_submit_generations. Repeat until all rounds complete. If submissions are rejected, fix surgically; only use finalize:true if I ask.
6. report_plan → you draft the narrative from the evidence pack (exactly 3 risks, each citing real post ids) → report_submit → report_export.
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
      `I want a social-simulation prediction. Question: ${a.question}\nSources: ${a.sources || "(ask me — I may point you at files in this repo, paste text, or give URLs; fetch URLs yourself and pass the extracted text to seed_add_url)"}\n${PIPELINE_RULES}`,
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
      `I want a mid-run social simulation. Question: ${a.question}\nSources: ${a.sources || "(ask me)"}\nRun the pipeline as usual (world_init → seeds → ontology → graph → personas → sim_configure with ${a.rounds || 4}+ total rounds), but PAUSE after round ${a.rounds || 4}:\n` +
      `- Show me sim_timeline and the sentiment per entity so far.\n- Ask me whether to sim_inject_event (describe a hypothetical event) or continue.\n- On continue: keep looping sim_next_batch → sim_submit_generations to the final round, then report_plan → report_submit → report_export and summarize.\n${PIPELINE_RULES}`,
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
        ? `Interview the simulated persona ${a.persona}. Question: "${a.question}"\nCall interview_agent(persona, question) → answer strictly from the returned pack, in first person, citing their own post ids, declining what they never saw → call interview_agent again with persona+question+answer to log it. Then relay the answer to me. If I keep asking follow-ups, repeat this loop.`
        : `Ask the Murmur ReportAgent: "${a.question}"\nCall report_agent_ask(question) → answer using ONLY the evidence pack, citing post ids like (po_12), separating strong from weak evidence → call report_agent_ask again with question+answer to log it. Relay the answer to me and repeat for follow-ups.`,
  },
  {
    name: "murmur-resume",
    title: "Murmur: Resume",
    description: "Reopen a saved world at its exact stage boundary and continue where it left off (crash-safe by construction).",
    args: [{ name: "world", required: false, description: "World id/slug; omit to list worlds" }],
    build: (a) =>
      `Resume a Murmur world. ${a.world ? `World: ${a.world}.` : "First call world_list and show me the worlds, then ask which to open."}\nCall world_open (or pick the world), then world_status — it tells you the stage, counts and the exact next tool. Continue the pipeline from there: seeds → ontology → graph → personas → simulation loop → report → interviews. Never redo completed stages; every receipt names the next step.`,
  },
];

export function findPrompt(name: string): MurmurPrompt | undefined {
  return PROMPTS.find((p) => p.name === name || p.name === `murmur-${name}`);
}
