#!/usr/bin/env node
/**
 * Murmur LIVE DEMO — drives the REAL murmur-mcp server (built dist) over
 * stdio, the exact transport Claude Code / Codex / OpenCode / Antigravity
 * use, through the complete sample scenario "Acme Cloud pricing change".
 *
 * The "brain" — the part your coding agent's LLM plays in real use — is
 * played by the deterministic mock (tests/helpers/mock-brain.mjs), so this
 * demo needs ZERO API keys and replays byte-identically with the same seed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Portable layout: this script lives in <bundle>/tools/ with the monorepo
// (murmur/) and the demo workspace (murmur-demo/) as siblings — move the
// bundle anywhere and these still resolve. Requires one `npm install` inside
// murmur/ (the MCP SDK client is loaded from its node_modules).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MURMUR = path.resolve(HERE, "..", "murmur");
const DEMO = path.resolve(HERE, "..", "murmur-demo");
const imp = (p) => import(pathToFileURL(p).href);
const SERVER = path.join(MURMUR, "packages", "server", "dist", "index.js");

const { Client } = await imp(path.join(MURMUR, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"));
const { StdioClientTransport } = await imp(path.join(MURMUR, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"));
const { completeOntology, completePersonas, completeSim, completeReportTask } = await imp(path.join(MURMUR, "tests/helpers/mock-brain.mjs"));
const { SEED_CORPUS } = await imp(path.join(MURMUR, "tests/helpers/pipeline.mjs"));
const W = 74;

// ---------- transcript plumbing ------------------------------------------------
const lines = [];
const say = (s = "") => { console.log(s); lines.push(s); };
const t0 = Date.now();
const stage = (n, title) => {
  say("");
  say("  " + "━".repeat(W));
  say(`  STAGE ${n} · ${title}   (t+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  say("  " + "━".repeat(W));
};
const arrow = (name, disp) => say(`  ➜ ${name}(${disp ?? ""})`);
const out = (s) => say(`    ${s}`);
const note = (s) => say(`      ${s}`);
const j = (x) => JSON.stringify(x);
const bar = (v) => (v < 0 ? "-" : "+") + "█".repeat(Math.max(1, Math.min(10, Math.round(Math.abs(v) * 10))));

const maxTok = { v: 0 };
const callLog = [];
async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  maxTok.v = Math.max(maxTok.v, Math.ceil(text.length / 4));
  callLog.push(name);
  const parsed = JSON.parse(text);
  if (parsed && parsed.ok === false) throw new Error(`${name} returned ok:false → ${text.slice(0, 300)}`);
  return parsed;
}

async function spawn() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: DEMO,
    // MURMUR_WORKSPACE isolates the demo: by default the server roots .murmur/
    // at the enclosing git repo (like git itself walks up) — here we pin it.
    env: { ...process.env, MURMUR_LOG: "error", MURMUR_WORKSPACE: DEMO },
  });
  const client = new Client({ name: "murmur-demo", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

// ---------- workspace -----------------------------------------------------------
// Only the generated state is wiped — never the whole demo directory, which also
// holds tracked docs (FLAGSHIP-DEMO.md, flagship.config.json, TRY-IT.md).
fs.rmSync(path.join(DEMO, ".murmur"), { recursive: true, force: true });
fs.mkdirSync(path.join(DEMO, ".murmur"), { recursive: true });
fs.cpSync(path.join(MURMUR, "examples"), path.join(DEMO, "examples"), { recursive: true });

say("┌" + "─".repeat(W + 2) + "┐");
say("│  MURMUR LIVE DEMO — sample scenario: \"Acme Cloud pricing change\"" + " ".repeat(W - 59) + "│");
say("│  real MCP server over stdio · the transport your coding agent uses" + " ".repeat(W - 63) + "│");
say("└" + "─".repeat(W + 2) + "┘");
say("");
say("  WHO DOES WHAT");
say("  · you               drop docs + ask questions, inside your coding agent");
say("  · agent LLM         the \"brain\": drafts entities, personas, posts, reports");
say("                    (played today by a deterministic mock — zero API keys)");
say("  · murmur-mcp        deterministic engine: validates, simulates, aggregates");
say(`  · workspace         ${DEMO}`);
say("");

// ================================ STAGE 0 ======================================
stage(0, "CONNECT — server spawn + contract");
const client = await spawn();
const tools = await client.listTools();
const prompts = await client.listPrompts();
out(`connected over stdio · ${tools.tools.length} tools · ${prompts.prompts.length} prompt playbooks (${prompts.prompts.map((p) => p.name).join(", ")})`);
const pb = await client.getPrompt({ name: "murmur-predict", arguments: { question: "How will r/programming and X/Twitter react to our new pricing?" } });
const pbText = String(pb.messages[0]?.content?.text ?? "");
out(`the /murmur-predict playbook your agent expands — first lines:`);
for (const l of pbText.split("\n").slice(0, 10)) note(l);
note("…");

// ================================ STAGE 1 ======================================
stage(1, "CREATE THE WORLD");
const worldArgs = { name: "pricing-reaction", description: "How will developers react to the Pro plan price change?", seed: "acme-demo-2026" };
arrow("world_init", j(worldArgs));
const init = await call(client, "world_init", worldArgs);
out(`world ${init.world.id} · slug "${init.world.slug}" · stage: ${init.world.stage}`);
out(`engine tells the agent what is next: ${init.next}`);

// ================================ STAGE 2 ======================================
stage(2, "FEED IT YOUR DOCS (seeds)");
arrow("seed_add_files", j({ paths: ["examples/pricing-page.md", "examples/FAQ.md", "examples/CHANGELOG.md"] }));
const files = await call(client, "seed_add_files", { paths: ["examples/pricing-page.md", "examples/FAQ.md", "examples/CHANGELOG.md"] });
for (const s of files.seeds) out(`${String(s.path).padEnd(26)} → ${s.ok === false ? "ERROR: " + s.error : s.seedId + " · " + s.bytes + " bytes" + (s.duplicate ? " · duplicate (deduped)" : "")}`);
out(`coverage: ${j(files.coverage)}`);
arrow("seed_add_text", j({ title: "Competitive context brief", text: "«strategy brief — elided»" }));
const brief = await call(client, "seed_add_text", { title: "Competitive context brief", text: SEED_CORPUS });
out(`${brief.seed.id} · ${brief.seed.bytes} bytes · digest: ${String(brief.seed.digest).slice(0, 90)}…`);
arrow("seeds_review");
const review = await call(client, "seeds_review");
for (const s of review.seeds) out(`${s.kind.padEnd(5)} ${String(s.title).slice(0, 40).padEnd(40)} ${String(s.bytes).padStart(6)} B`);
out(`coverage: ${j(review.coverage)}`);
out(`next: ${review.next}`);

// ================================ STAGE 3 ======================================
stage(3, "ONTOLOGY — the brain extracts the entities");
arrow("ontology_plan");
const ontPlan = await call(client, "ontology_plan");
out(`task ${ontPlan.taskId} · the brain sees ${ontPlan.task.items[0].payload.seeds.length} seed digests and is asked for entities + types + salience + motives + anchors`);
const ontResult = completeOntology(ontPlan.task);
arrow("ontology_submit", `{ task_id: "${ontPlan.taskId}", result: ${ontResult.entities.length} entities }`);
const ont = await call(client, "ontology_submit", { task_id: ontPlan.taskId, result: ontResult });
out(`inserted ${ont.inserted} entities (engine validated types, salience, anchors):`);
for (const e of ont.entities.slice(0, 10)) out(`${e.name.slice(0, 24).padEnd(24)} ${e.type.padEnd(8)} salience ${e.salience}`);
if (ont.entities.length > 10) out(`… +${ont.entities.length - 10} more`);
out(`next: ${ont.next}`);
const tracked = (ont.entities.find((e) => /acme/i.test(e.name)) ?? ont.entities[0]).name;

// ================================ STAGE 4 ======================================
stage(4, "TENSION GRAPH — deterministic derivation");
arrow("graph_build");
const g = await call(client, "graph_build");
out(`${g.relations} relations · ${g.tensionsAbove05} tensions > 0.5 · ${g.communities} communities (subreddits derived from entity types)`);
for (const t of (g.topTensions ?? []).slice(0, 3)) out(`top tension: ${j(t)}`);
arrow("graph_export_mermaid");
const mm = await call(client, "graph_export_mermaid");
out(`wrote ${mm.path} · ${mm.nodes} nodes · ${mm.edges} edges — first lines:`);
const mmLines = fs.readFileSync(path.join(DEMO, String(mm.path)), "utf8").split("\n");
for (const l of mmLines.slice(0, 16)) note(l);
if (mmLines.length > 16) note(`… +${mmLines.length - 16} more lines`);

// ================================ STAGE 5 ======================================
stage(5, "POPULATION — the brain drafts the personas");
arrow("personas_plan", j({ count: 12 }));
const pPlan = await call(client, "personas_plan", { count: 12 });
out(`task ${pPlan.taskId} · archetype menu the engine offers: ${pPlan.task.items[0].payload.population.archetypes.map((a) => a.name).join(", ")}`);
const pResult = completePersonas(pPlan.task);
arrow("personas_submit", `{ task_id: "${pPlan.taskId}", result: 12 personas }`);
const pop = await call(client, "personas_submit", { task_id: pPlan.taskId, result: pResult });
out(`population ${pop.population} · platform mix ${j(pop.platformBreakdown)} · ${pop.followEdges} follow edges · ${pop.communityMemberships} community memberships`);
out(`archetypes ${j(pop.archetypeBreakdown)}`);
const firstP = String(pop.personaIds[0]);
arrow("persona_inspect", j({ persona: firstP }));
const insp = await call(client, "persona_inspect", { persona: firstP });
const card = insp.card?.card ?? insp.card;
const tok = insp.card?.tokens ?? "?";
out(`${card.name} (${card.handle}) · ${card.archetype} · ${card.platform}`);
out(`persona card as the sim will see it (${tok} tokens, budget 120): ${j({ traits: card.traits, stances: card.stances, activity: card.activity })}`);
out(`stance detail: ${insp.persona.stancesDetailed.slice(0, 4).map((s) => `${s.entity} ${s.stance}`).join(" · ")}`);
out(`follows: ${insp.persona.followsHandles.join(", ")}`);
out(`recent posts: ${(insp.recentPosts ?? []).length} (simulation not started yet)`);

// ================================ STAGE 6 ======================================
stage(6, "SIMULATION — 5 rounds on two platforms");
arrow("sim_configure", j({ rounds: 5 }));
await call(client, "sim_configure", { rounds: 5 });
out(`5 rounds configured · stage: configured`);

// ---- round 1, shown in detail ----
arrow("sim_next_batch");
let batch = await call(client, "sim_next_batch");
out(`round ${batch.round} · ${batch.personas} personas activated · batch ≈ ${batch.totalTokens} tokens (feeds personalized per persona)`);
const d0 = batch.task.items[0].payload;
out(`── what the brain sees for ONE persona (${d0.persona.name}, ${d0.persona.handle}) ──`);
note(`card: ${j(d0.persona)}`);
note(`memory: ${j(d0.memory).slice(0, 140)}…`);
note(`feed (ranked: recency + virality + affinity + stance salience):`);
for (const f of (d0.feed ?? []).slice(0, 3)) note(`  ${f.id} ${f.by} [${f.plat}] ${String(f.body).slice(0, 80)}`);
const col0 = d0.collective ?? {};
note(`collective: trending ${j(col0.trending ?? []).slice(0, 80)} · events ${j(col0.events ?? []).slice(0, 80)}`);
note(`allowed actions: ${j(d0.allowedActions)}`);
const gens = completeSim(batch.task);
arrow("sim_submit_generations", `{ task_id: "${batch.taskId}", generations: ${gens.length} persona action sets }`);
let sub = await call(client, "sim_submit_generations", { task_id: batch.taskId, generations: gens });
const s1 = sub.statsDigest;
out(`round ${sub.round} applied · ${sub.postsCreated} posts created · ${sub.appliedPersonas} personas acted, ${sub.lurkers} lurked`);
out(`stats: tw ${s1.postsByPlatform.twitter} · rd ${s1.postsByPlatform.reddit} · engagement ${s1.engagement.likes + s1.engagement.reposts + s1.engagement.upvotes + s1.engagement.downvotes} · "${tracked}" sentiment ${s1.sentimentByEntity[tracked] ?? "n/a"} · escalations ${s1.escalations}`);

// ---- inject an event before round 3 ----
arrow("sim_inject_event", j({ text: "Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30%", round: 3 }));
const inj = await call(client, "sim_inject_event", { text: "Nimbus Labs announces a one-click import tool that undercuts Acme Cloud pricing by 30%", round: 3, type: "price" });
out(`event ${inj.eventId} queued for round ${inj.landsInRound} — activated personas will see it in their digest`);

// ---- rounds 2..5, compact ----
for (const r of [2, 3, 4, 5]) {
  batch = await call(client, "sim_next_batch");
  const g2 = completeSim(batch.task);
  arrow("sim_next_batch → sim_submit_generations", `{ round ${batch.round}, ${batch.personas} personas }`);
  sub = await call(client, "sim_submit_generations", { task_id: batch.taskId, generations: g2 });
  const s = sub.statsDigest;
  const ev = s.engagement.likes + s.engagement.reposts + s.engagement.upvotes + s.engagement.downvotes;
  out(`round ${sub.round} · tw ${s.postsByPlatform.twitter} · rd ${s.postsByPlatform.reddit} · engagement ${ev} · "${tracked}" sentiment ${s.sentimentByEntity[tracked] ?? "n/a"} ${s.sentimentByEntity[tracked] != null ? bar(s.sentimentByEntity[tracked]) : ""} · escalations ${s.escalations} · movers ${s.topMovers.length ? s.topMovers.slice(0, 2).map((m) => `${m.entity} ${m.from}→${m.to}`).join(", ") : "—"}`);
}
out(`simulation complete: ${sub.completed} · stage: ${sub.next}`);

arrow("sim_timeline");
const tl = await call(client, "sim_timeline");
out(`round │  tw │  rd │ engagement │ sentiment toward "${tracked}"`);
for (const row of tl.timeline) {
  const sv = row.sentimentByEntity?.[tracked];
  out(`${String(row.round).padStart(5)} │ ${String(row.twitter).padStart(3)} │ ${String(row.reddit).padStart(3)} │ ${String(row.engagement).padStart(10)} │ ${sv != null ? sv.toFixed(2).padStart(6) + " " + bar(sv) : "    —"}`);
}
out(`engagement peaks (μ+2σ): ${j(tl.engagementPeaks)}`);

// ================================ STAGE 7 ======================================
stage(7, "REPORT — the brain narrates, the engine grounds it");
arrow("report_plan", j({ focus: "developer reaction to the pricing change" }));
const rPlan = await call(client, "report_plan", { focus: "developer reaction to the pricing change" });
out(`task ${rPlan.taskId} · the brain gets a stats pack + evidence posts and must cite real post ids in exactly 3 risks`);
const draft = completeReportTask(rPlan.task);
arrow("report_submit", `{ task_id: "${rPlan.taskId}", draft: recap + findings + trajectory + 3 risks (mitigated) + recommendations + confidence }`);
const rep = await call(client, "report_submit", { task_id: rPlan.taskId, draft });
out(`report v${rep.version} stored · engine verified every cited post id exists:`);
for (const r of rep.risks) note(r);
arrow("report_export");
const ex = await call(client, "report_export", { format: "both" });
const mdRel = ex.files.find((f) => f.path.endsWith(".md"));
const htmlRel = ex.files.find((f) => f.path.endsWith(".html"));
const reportFile = path.join(DEMO, String(mdRel.path));
out(`wrote ${mdRel.path} (${mdRel.bytes} bytes) + ${htmlRel.path} (${htmlRel.bytes} bytes) — dashboard and full report:`);
out(`open ${htmlRel.path} in a browser: same numbers as the .md, same engine computation`);
say("");
const md = fs.readFileSync(reportFile, "utf8");
const mdLines = md.split("\n");
for (const l of mdLines.slice(0, 62)) say(l.length ? l : "");
if (mdLines.length > 62) say(`… +${mdLines.length - 62} more lines (stance bars, post index) — see the file`);

// ================================ STAGE 8 ======================================
stage(8, "INTERROGATE THE WORLD (F7)");
arrow("interview_agent", j({ persona: firstP, question: "Why do you call the migration guide a paywall?" }));
const iv = await call(client, "interview_agent", { persona: firstP, question: "Why do you call the migration guide a paywall?" });
const ivp = iv.pack;
out(`engine grounded the interview — ${ivp.persona?.name ?? insp.persona.name} · ${ivp.posts?.length ?? 0} of their posts + ${ivp.memory?.length ?? 0} memories in the pack:`);
for (const p of (ivp.posts ?? []).slice(0, 3)) note(`${p.id} (r${p.round}, ${p.platform}, sentiment ${p.sentiment}) ${String(p.body).slice(0, 70)}`);
const recent = (ivp.posts ?? [])[0];
const ivAnswer = recent
  ? `Because I lived it — I said it myself in ${recent.id}: "${String(recent.body).slice(0, 60)}…". A third project goes read-only for 90 days then archives itself. Call that a migration guide all you want; it is a paywall with extra steps, and my feed agrees.`
  : "Because I have been watching this space for years — this is a paywall with extra steps.";
arrow("interview_agent", `{ persona, question, answer: "«in-character answer citing " + ${recent?.id ?? "own posts"} + »" }`);
const ivLog = await call(client, "interview_agent", { persona: firstP, question: "Why do you call the migration guide a paywall?", answer: ivAnswer });
out(`logged: ${ivLog.logged} → ${ivLog.file}`);

arrow("report_agent_ask", j({ question: "What are the posts behind the biggest risk, and how strong is the evidence?" }));
const ask = await call(client, "report_agent_ask", { question: "What are the posts behind the biggest risk, and how strong is the evidence?" });
out(`evidence pack (matched: ${j(ask.pack.matchedEntities)}):`);
for (const e of (ask.pack.evidence ?? []).slice(0, 3)) note(`${e.id} ${e.by} [${e.plat}] r${e.round} sentiment ${e.sentiment} — ${String(e.body).slice(0, 70)}`);
const ev0 = (ask.pack.evidence ?? [])[0];
const askAnswer = `The strongest evidence is ${ev0 ? `${ev0.id} (${ev0.by}, round ${ev0.round}, sentiment ${ev0.sentiment})` : "the escalation chains"}${(ask.pack.evidence ?? [])[1] ? `, plus ${(ask.pack.evidence ?? [])[1].id} which escalated within one round` : ""}. Engagement concentrated on these posts across multiple rounds — strong evidence, not weak.`;
arrow("report_agent_ask", `{ question, answer: "«answer citing " + ${ev0?.id ?? "evidence"} + »" }`);
const askLog = await call(client, "report_agent_ask", { question: "What are the posts behind the biggest risk, and how strong is the evidence?", answer: askAnswer });
out(`logged: ${askLog.logged} → ${askLog.file}`);

// ================================ STAGE 9 ======================================
stage(9, "CRASH-PROOF RESUME — brand-new session");
await client.close();
const client2 = await spawn();
out("killed the first client, spawned a fresh server process — the world persists in .murmur/murmur.db");
arrow("world_list");
const wl = await call(client2, "world_list");
out(`${wl.worlds.length} world: ${wl.worlds[0].name} · ${wl.worlds[0].stage} · round ${wl.worlds[0].round}`);
arrow("world_open", j({ world: wl.worlds[0].id }));
const wo = await call(client2, "world_open", { world: String(wl.worlds[0].id) });
out(`active again · stage ${wo.world.stage} · next: ${wo.next}`);
arrow("world_status");
const st = await call(client2, "world_status");
out(`stage ${st.stage ?? st.world?.stage} · counts ${j(st.counts)} · next ${j(st.next)}`);
await client2.close();

// ================================ FOOTER =======================================
say("");
say("  " + "━".repeat(W));
say("  ARTIFACTS ON DISK (everything is a plain file you can commit)");
say("  " + "━".repeat(W));
const walk = (dir, prefix = "") => {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const e of entries) {
    if (e.name === "murmur.db-wal" || e.name === "murmur.db-shm") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { say(`${prefix}${e.name}/`); walk(p, prefix + "  "); }
    else say(`${prefix}${e.name}  (${fs.statSync(p).size} B)`);
  }
};
walk(path.join(DEMO, ".murmur"));

say("");
say("  " + "─".repeat(W));
out(`tool calls this session: ${callLog.length} · largest single response: ${maxTok.v} tokens (budget 12,000) · wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
out("determinism: same seed + same generations ⇒ byte-identical replay (enforced by the golden test)");
out("in real use: YOUR coding agent (Claude Code, Codex, OpenCode, Antigravity, …) writes what the mock");
out("brain wrote here — the engine validates, simulates and aggregates. No API keys, ever.");
say("  " + "─".repeat(W));

fs.writeFileSync(path.join(DEMO, "DEMO-TRANSCRIPT.md"), lines.join("\n") + "\n");
say("");
say(`Full transcript saved → ${path.join(DEMO, "DEMO-TRANSCRIPT.md")}`);
