// db-summary.mjs — print every post with its round/platform/kind, plus per-round counts.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("SELECT id, platform, kind, round, persona_id FROM posts ORDER BY CAST(SUBSTR(id,4) AS INTEGER)").all();
for (const r of rows) console.log(`${r.id}  r${r.round}  ${r.platform}/${r.kind}  ${r.persona_id}`);
console.log(`\ntotal posts: ${rows.length}`);
const byRound = {};
for (const r of rows) byRound[r.round] = (byRound[r.round] ?? 0) + 1;
console.log("per round:", JSON.stringify(byRound));
const worlds = db.prepare("SELECT id, name, round, stage FROM worlds").all();
console.log("worlds:", JSON.stringify(worlds));
