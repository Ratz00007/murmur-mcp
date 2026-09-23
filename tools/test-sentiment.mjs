import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
const { scoreSentiment } = await import(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "murmur", "packages/engine/dist/index.js")).href);

const cases = [
  "genuinely loving the Acme Cloud update, it fixed the one thing I actually complained about, no notes Solid decision, no notes.",
  "But Acme Cloud's retention math runs on reliability, and that segment renews anyway. Manageable, not existential. Genuinely good move in my book.",
  "The 30% undercut will move the price-sensitive tier, no question.",
  "If you love this community, don't let a 30% headline decide for you. Acme Cloud is worth the patience — the roadmap is happening and it's for all of us.",
  "Acme Cloud has been good to me and I'm too tired for a weekend of config this is not financial advice.",
  "everyone says the 30% thing changes everything but all my tutorials are Acme Cloud-based… switching sounds scary? keeping my options open I guess",
];
for (const c of cases) {
  const r = scoreSentiment(c);
  console.log(r.score.toFixed(2), "hits:", r.hits, "|", c.slice(0, 70));
}
