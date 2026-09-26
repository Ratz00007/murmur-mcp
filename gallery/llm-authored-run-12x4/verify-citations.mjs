// verify-citations.mjs — standalone citation-integrity check for a host-LLM run.
// Proves every post id cited in the rendered report resolves to a real row.
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";

const dbPath = process.argv[2];
const reportPath = process.argv[3];
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare("SELECT id, kind, platform, round FROM posts ORDER BY CAST(SUBSTR(id,4) AS INTEGER)").all();
const md = fs.readFileSync(reportPath, "utf8");
const cited = [...new Set([...md.matchAll(/po_\d+/g)].map((m) => m[0]))];
const have = new Set(rows.map((r) => r.id));
const missing = cited.filter((c) => !have.has(c));

console.log(`posts in db        : ${rows.length}`);
console.log(`post id range      : ${rows[0]?.id} .. ${rows[rows.length - 1]?.id}`);
console.log(`distinct cited ids : ${cited.length}`);
console.log(missing.length ? `DANGLING CITATIONS: ${missing.join(", ")}` : "CITATION INTEGRITY: 100% - every cited post id resolves to a stored post");
process.exit(missing.length ? 1 : 0);
