// inspect.mjs — one-line world state summary for a Murmur workspace.
// Usage: node inspect.mjs <workspace-root>   (the dir that CONTAINS .murmur/)
import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";

const root = process.argv[2] ?? process.cwd();
const db = new DatabaseSync(path.join(root, ".murmur", "murmur.db"), { readOnly: true });
const one = (sql) => { try { return db.prepare(sql).get(); } catch { return null; } };
const w = one("SELECT id,name,slug,stage,round,seed FROM worlds LIMIT 1");
if (!w) { console.log("no world in", path.join(root, ".murmur")); process.exit(0); }
const c = (t) => one(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? "?";
const posts = db.prepare("SELECT id,kind,platform,round FROM posts ORDER BY CAST(SUBSTR(id,4) AS INTEGER)").all();
const rpt = one("SELECT COUNT(*) AS n FROM reports");
console.log(`world      : ${w.name} (${w.slug})  stage=${w.stage} round=${w.round}`);
console.log(`seed       : ${w.seed}`);
console.log(`entities   : ${c("entities")}   personas: ${c("personas")}   posts: ${posts.length}   reports: ${rpt.n}`);
if (posts.length) {
  const byRound = {};
  for (const p of posts) byRound[p.round] = (byRound[p.round] ?? 0) + 1;
  console.log(`posts/round: ${Object.entries(byRound).map(([k, v]) => `r${k}=${v}`).join("  ")}`);
  console.log(`id range   : ${posts[0].id} .. ${posts[posts.length - 1].id}`);
}
