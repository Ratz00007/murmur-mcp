/**
 * Headless full-pipeline runner + shared seed corpus.
 * Used by the golden-run test (via vitest alias -> engine src) and by
 * tests/cleanroom/demo-run.mjs (via engine dist). The engine module is
 * injected, so both paths share one orchestration.
 */
import { completeOntology, completePersonas, completeSim, completeReportTask } from "./mock-brain.mjs";

export const SEED_CORPUS = `# Acme Cloud pricing change brief

Acme Cloud is raising the price of its Pro plan by 40 percent starting next quarter. The company says the increase funds reliability work and a new observability layer. Existing customers keep current pricing for six months, then migrate to the new plans.

The free tier shrinks from three projects to one project. The API rate limits for the free tier drop from five thousand requests per hour to one thousand. The migration guide was published last week and already draws criticism on forums because it reads like a paywall.

Nimbus Labs, the closest competitor, immediately published a comparison page and announced it will undercuts Acme Cloud by offering an unlimited free tier for small teams. Nimbus Labs also launched a one-click import tool for existing Acme Cloud projects.

StackHaven, the open-source rival, saw a spike of interest after the announcement. Community moderators on the StackHaven forum pinned a migration thread. Some longtime Acme Cloud advocates argue the pricing change is fair because the platform doubled its uptime and shipped a major API overhaul this year.

Developers on social media split into camps. One camp calls the pricing change a betrayal and threatens to churn. Another camp defends Acme Cloud, pointing out that the roadmap includes federation and on-prem support that competitors cannot match. A third camp is mostly confused about the migration timeline and what happens to their existing projects.

Analysts note that Acme Cloud revenue grew steadily for three years, but the pricing change risks its reputation among developers, the segment that drove adoption. The enterprise segment is less sensitive to pricing, and Acme Cloud plans an enterprise roadshow in six cities.

The changelog for the pricing release mentions an amnesty window for students and nonprofits. The FAQ says data exports remain free forever. Support response times will not change. The CEO of Acme Cloud posted a thread defending the decision, calling the pricing change an investment in the next decade of the platform.`;

export async function runPipeline(
  engine,
  opts = {}
) {
  const o = {
    cwd: opts.cwd,
    worldName: opts.worldName ?? "pricing-reaction",
    seed: opts.seed ?? "golden-seed",
    rounds: opts.rounds ?? 5,
    population: opts.population ?? 12,
    injectAtRound: opts.injectAtRound ?? null,
    injectText: opts.injectText ?? null,
  };
  const ws = new engine.Workspace(o.cwd);
  ws.ensure();
  const storage = new engine.Storage(engine.openDatabase(ws.dbPath));
  const world = storage.createWorld({ name: o.worldName, seed: o.seed });
  ws.ensureWorldDir(world.slug);
  storage.addSeed(world.id, {
    kind: "text",
    title: "Acme pricing brief",
    ref: "brief.md",
    text: SEED_CORPUS,
    digest: engine.makeDigest(SEED_CORPUS),
  });
  storage.setStage(world.id, "seeded");

  const ontologyTask = engine.buildOntologyTask(storage, world);
  const ontologyTaskTokens = engine.estTokens(JSON.stringify(ontologyTask));
  const ontologyResult = completeOntology(ontologyTask);
  const ontology = engine.applyOntology(storage, world, ontologyTask.id, ontologyResult);
  if (ontology.rejected.length > 0) throw new Error("ontology rejected: " + JSON.stringify(ontology.rejected.slice(0, 3)));

  engine.buildGraph(storage, world);
  // graph artifact (same file graph_export_mermaid writes when driven via MCP)
  const graphResult = engine.graphQuery(storage, world, { minTension: 0, tokenBudget: 8000 });
  ws.writeAtomic(ws.graphPath(world.slug), engine.toMermaid(graphResult));

  const personasTask = engine.buildPersonasTask(storage, world, { count: o.population });
  const personasTaskTokens = engine.estTokens(JSON.stringify(personasTask));
  const personasResult = engine.applyPersonas(storage, world, personasTask.id, completePersonas(personasTask));
  if (personasResult.rejected.length > 0) throw new Error("personas rejected: " + JSON.stringify(personasResult.rejected.slice(0, 3)));

  const w = () => storage.getWorld(world.id);
  storage.updateWorld(world.id, { config: { ...w().config, rounds: o.rounds } });
  storage.setStage(world.id, "configured");

  const batchTokens = [];
  const generationTokens = [];
  let generationItems = 0;
  while (w().round < o.rounds) {
    const targetRound = w().round + 1;
    if (o.injectAtRound === targetRound && o.injectText) {
      storage.addEvent(world.id, targetRound, "injection", { text: o.injectText, subtype: "news" }, "all");
    }
    const { task } = engine.buildSimBatch(storage, w());
    batchTokens.push(engine.estTokens(JSON.stringify(task)));
    const generations = completeSim(task);
    generationTokens.push(engine.estTokens(JSON.stringify(generations)));
    generationItems += task.items.length;
    const result = engine.submitGenerations(storage, w(), task.id, generations, {});
    if (result.rejected.length > 0) {
      // mock brain must be schema-valid; if the validator disagrees, surface it loudly
      throw new Error("sim rejected: " + JSON.stringify(result.rejected.slice(0, 5)));
    }
  }

  const reportTask = engine.buildReportTask(storage, w(), "community reaction to the pricing change");
  const reportTaskTokens = engine.estTokens(JSON.stringify(reportTask));
  const draft = completeReportTask(reportTask);
  const draftTokens = engine.estTokens(JSON.stringify(draft));
  const validated = engine.validateReportDraft(storage, w(), draft);
  if (validated.rejected.length > 0) throw new Error("report rejected: " + JSON.stringify(validated.rejected.slice(0, 3)));
  const record = engine.storeReport(storage, w(), validated.draft, "community reaction to the pricing change");
  const markdown = engine.renderReportMarkdown(storage, w(), record);
  const reportPath = ws.reportPath(w().slug, record.version);
  ws.writeAtomic(reportPath, markdown);
  // record path on the report row
  storage.db.prepare("UPDATE reports SET path=? WHERE id=?").run(ws.rel(reportPath), record.id);

  return {
    storage,
    worldId: world.id,
    world: w(),
    reportPath,
    reportVersion: record.version,
    markdown,
    batchTokens,
    entityCount: ontology.insertedCount,
    /**
     * Measured host-LLM budget (chars/4 estimator, same one the NFR uses).
     * input = task payloads the host must read; output = content it must write.
     */
    tokenBudget: {
      ontologyTask: ontologyTaskTokens,
      personasTask: personasTaskTokens,
      simTasks: batchTokens.reduce((a, b) => a + b, 0),
      simRounds: batchTokens.length,
      reportTask: reportTaskTokens,
      inputTotal: ontologyTaskTokens + personasTaskTokens + batchTokens.reduce((a, b) => a + b, 0) + reportTaskTokens,
      generations: generationTokens.reduce((a, b) => a + b, 0),
      draftTokens,
      outputTotal: generationTokens.reduce((a, b) => a + b, 0) + draftTokens,
      generationItems,
      population: o.population,
      rounds: o.rounds,
      markdownChars: markdown.length,
    },
    dump: () => storage.dumpWorld(world.id),
    close: () => storage.close(),
  };
}
