/**
 * Deterministic mock "host LLM" for tests, golden runs and the headless demo.
 * Plain ESM JavaScript so it can be imported by both vitest tests and plain
 * node scripts (.mjs) without a build step. Zero dependencies.
 *
 * It completes the four generation-task kinds with schema-valid content,
 * seeded by (task id + persona id) so identical runs replay identically.
 */

// --- tiny deterministic rng -------------------------------------------------
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = (key) => mulberry32(fnv(String(key)));
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// --- word pools --------------------------------------------------------------
const POS = ["love", "great", "impressive", "excellent news", "a win", "genuinely good", "excited"];
const NEG = ["hate", "terrible", "a ripoff", "frustrating", "bad news", "disappointing", "outrageous"];
const STOP = new Set(
  "the a an and or but if while of to in on for with without at by from as is are was were be been this that these those it its we you they he she i our your their not no nor so than then there here what which who when where why how all any both each few more most other some such only own same too very will just don should now about into over after before under above out off again once does did doing have has had would could may might must shall also however therefore per via etc get got make made use used using one two three new like due within across between because during through against among upon".split(
    " "
  )
);

const NAMES = [
  "Ada Okafor", "Ben Sørensen", "Cara Lindqvist", "Dev Patel", "Elena Rossi", "Felix Moreau",
  "Grace Kim", "Hugo Álvarez", "Ines Duarte", "Jonas Weber", "Kira Novak", "Liam Byrne",
  "Maya Chandra", "Noah Fischer", "Olivia Santos", "Pavel Horak", "Quinn Ashworth", "Rosa Delgado",
  "Samir Haddad", "Tessa Jansen", "Umar Diallo", "Vera Petrova", "Willem Bosch", "Xiu Chen",
  "Yara Nasser", "Zach Vogel", "Anya Iversen", "Bruno Costa", "Clara Nyberg", "Dmitri Volkov",
  "Emi Tanaka", "Farah Nazari",
];

// --- ontology ----------------------------------------------------------------
export function completeOntology(task) {
  const item = task.items[0];
  const seeds = item.payload.seeds || [];
  const allText = seeds.map((s) => s.text.replace(/<\/?seed>/g, "")).join("\n");
  const candidates = [];
  const seen = new Set();
  // capitalized multi-word phrases first (strong signals) — skip article-led noise
  const phrases = (allText.match(/\b([A-Z][a-zA-Z0-9]+(?: [A-Z][a-zA-Z0-9]+)+)\b/g) || []).filter(
    (p) => !/^(The|A|An|This|That|These|Those) /.test(p)
  );
  for (const p of phrases) {
    if (!seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      candidates.push(p);
    }
  }
  // then frequent keywords
  const freq = new Map();
  for (const w of allText.toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const keywords = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [w] of keywords) {
    const t = w[0].toUpperCase() + w.slice(1);
    if (!seen.has(w)) {
      seen.add(w);
      candidates.push(t);
    }
  }
  const types = ["org", "product", "topic", "person", "topic", "org", "topic", "product", "topic", "idea", "person", "topic", "org", "topic", "place", "event"];
  const sentences = allText.split(/(?<=[.!?])\s+/);
  const entities = candidates.slice(0, 14).map((name, i) => {
    const re = new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i");
    const anchors = sentences.filter((s) => re.test(s)).slice(0, 2).map((s) => s.trim().slice(0, 220));
    return {
      name,
      type: types[i % types.length],
      description: `${name} appears repeatedly across the source material and shapes the scenario.`,
      salience: Math.round((0.9 - i * 0.045) * 100) / 100,
      anchors,
      motives: [`${name} wants to ${pick(rng(`m:${name}`), ["grow adoption", "protect revenue", "avoid backlash", "shape the narrative", "keep users loyal", "move fast without breaking trust"])}`],
    };
  });
  return { entities };
}

// --- personas -----------------------------------------------------------------
export function completePersonas(task) {
  const pop = task.items[0].payload.population;
  const count = pop.count;
  const archetypes = pop.archetypes.map((a) => a.name);
  const entities = pop.entities;
  const personas = [];
  for (let i = 0; i < count; i++) {
    const r = rng(`${task.id}:p:${i}`);
    const name = NAMES[i % NAMES.length];
    const platform = i % 5 < 2 ? "twitter" : i % 5 < 4 ? "reddit" : "both";
    const stances = {};
    for (const e of entities.slice(0, 5)) {
      let v;
      if (e.stanceHint.startsWith("hostile")) v = -(0.45 + r() * 0.4);
      else if (e.stanceHint.startsWith("sympathetic")) v = 0.45 + r() * 0.4;
      else if (e.stanceHint.startsWith("divisive")) v = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.4);
      else v = (r() < 0.5 ? -1 : 1) * r() * 0.35;
      stances[e.name] = Math.round(v * 100) / 100;
    }
    personas.push({
      name,
      handle: platform === "reddit" ? `u/${name.split(" ")[0].toLowerCase()}${i}` : `@${name.split(" ")[0].toLowerCase()}${i}`,
      archetype: archetypes[i % archetypes.length],
      bio: `${archetypes[i % archetypes.length]} who ${pick(r, ["lives in release notes", "ships side projects on weekends", "argues about pricing on the internet", "migrated three teams last year", "reads every changelog twice"])}.`,
      traits: {
        openness: Math.round(r() * 100) / 100,
        conscientiousness: Math.round(r() * 100) / 100,
        extraversion: Math.round(r() * 100) / 100,
        agreeableness: Math.round(r() * 100) / 100,
        emotionalStability: Math.round(r() * 100) / 100,
      },
      stances,
      platform,
      activity: Math.round((0.3 + r() * 0.65) * 100) / 100,
    });
  }
  return { personas };
}

// --- sim ----------------------------------------------------------------------
export function completeSim(task) {
  const out = [];
  for (const item of task.items) {
    const d = item.payload;
    const p = d.persona;
    const r = rng(`${task.id}:${p.id}`);
    const actions = [];
    const stances = (p.stances || []).slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const top = stances[0];
    const words = top && top[1] > 0.15 ? POS : top && top[1] < -0.15 ? NEG : POS.concat(NEG);
    const events = (d.collective && d.collective.events) || [];

    // 1) react to an injected event
    if (events.length > 0 && r() < 0.7 && top) {
      const ev = events[0].replace(/<\/?event>/g, "");
      const sentimentWord = top[1] < -0.15 ? pick(r, NEG) : top[1] > 0.15 ? pick(r, POS) : "interesting";
      const body = `Just saw the news: ${ev.slice(0, 120)}. ${sentimentWord[0].toUpperCase() + sentimentWord.slice(1)} for ${top[0]}.`;
      if (p.platform === "reddit") {
        actions.push({ type: "post", platform: "reddit", title: `${ev.slice(0, 90)}`, body });
      } else {
        actions.push({ type: "post", platform: p.platform === "both" ? "twitter" : p.platform, body: body.slice(0, 280) });
      }
    }

    // 2) react to the feed
    const feed = (d.feed || []).filter((f) => f.id);
    if (actions.length < 2 && feed.length > 0 && r() < 0.65) {
      const target = feed[Math.floor(r() * feed.length) % feed.length];
      const mine = target.plat === "tw" && p.platform !== "reddit";
      if (mine && r() < 0.3) {
        actions.push({ type: "like", parent: target.id });
      } else if (mine) {
        const w = top && top[1] < -0.15 ? pick(r, NEG) : pick(r, POS);
        actions.push({ type: "reply", parent: target.id, body: `${w[0].toUpperCase() + w.slice(1)} take — this is really about ${top ? top[0] : "the principle"}.` });
      } else if (p.platform !== "twitter") {
        if (r() < 0.3) {
          actions.push({ type: top && top[1] < -0.15 ? "downvote" : "upvote", parent: target.id });
        } else {
          const w = top && top[1] < -0.15 ? pick(r, NEG) : pick(r, POS);
          actions.push({ type: "comment", parent: target.id, body: `${w[0].toUpperCase() + w.slice(1)} point, but the real story is ${top ? top[0] : "the migration"} — ${pick(r, ["been saying this for months", "nobody talks about this", "this matches my experience", "the docs disagree"])}.` });
        }
      }
    }

    // 3) occasionally post fresh
    if (actions.length === 0 && top && r() < 0.6) {
      const w = top[1] < -0.15 ? pick(r, NEG) : top[1] > 0.15 ? pick(r, POS) : "mixed feelings";
      if (p.platform === "reddit") {
        actions.push({ type: "post", platform: "reddit", title: `Thoughts on ${top[0]}?`, body: `Honestly ${w} about ${top[0]}. ${pick(r, ["Am I the only one?", "Change my mind.", "Curious what others think.", "Long-time follower, first-time poster."])}` });
      } else {
        actions.push({ type: "post", platform: p.platform === "both" ? "twitter" : p.platform, body: `${w[0].toUpperCase() + w.slice(1)} about ${top[0]} — ${pick(r, ["hot take", "just saying", "my honest read", "no notes"])}.` });
      }
    }
    out.push({ persona: p.id, actions });
  }
  return out;
}

// --- report ---------------------------------------------------------------------
export function completeReportTask(task) {
  const payload = task.items[0].payload;
  const stats = payload.stats;
  const evidence = payload.evidence || [];
  const rounds = stats.rounds || [];
  const last = rounds[rounds.length - 1] || { engagement: 0, sentimentByEntity: {} };
  const topEntity = evidence[0]?.entity || Object.keys(last.sentimentByEntity)[0] || "the scenario";
  const firstSent = rounds[0]?.sentimentByEntity?.[topEntity] ?? 0;
  const lastSent = last.sentimentByEntity?.[topEntity] ?? 0;
  const direction = lastSent < firstSent - 0.05 ? "souring" : lastSent > firstSent + 0.05 ? "warming" : "holding steady";

  const risks = [];
  const used = new Set();
  for (const ev of evidence) {
    if (risks.length >= 3) break;
    const post = (ev.posts || [])[0];
    if (!post || used.has(post.id)) continue;
    used.add(post.id);
    risks.push({
      title: `${ev.entity} sentiment ${post.sentiment < 0 ? "backlash" : "hype"} hardening`,
      rationale: `Across the run, posts about ${ev.entity} clustered at sentiment ${post.sentiment} with sustained engagement, and the strongest example (${post.id}) was written by ${post.by}. If this pattern holds post-simulation, it becomes the dominant narrative.`,
      severity: Math.abs(post.sentiment) > 0.4 ? "high" : "medium",
      postIds: [post.id],
    });
  }
  while (risks.length < 3) {
    const p = stats.topPosts?.[risks.length];
    if (!p) break;
    risks.push({
      title: `Escalation around ${p.by}'s high-engagement post`,
      rationale: `Post ${p.id} drew engagement ${p.engagement} at sentiment ${p.sentiment}; high-engagement anchors like this often seed escalation chains in the next cycle.`,
      severity: p.engagement > 5 ? "high" : "low",
      postIds: [p.id],
    });
  }

  return {
    executiveSummary: `Over ${rounds.length} rounds and ${rounds.reduce((a, r) => a + (r.twitter + r.reddit), 0)} simulated posts, the population's sentiment toward ${topEntity} ended ${direction} at ${lastSent.toFixed(2)} (from ${firstSent.toFixed(2)}). Engagement totaled ${last.engagement} in the final round. The three risks below are the strongest signals a launch team should pre-empt before this scenario plays out in public.`,
    trajectory: `Most-likely trajectory: sentiment toward ${topEntity} continues ${direction === "souring" ? "its downward drift as migration friction posts compound" : direction === "warming" ? "improving as early adopters post positive first impressions" : "sideways while the two factions argue"} — the simulation's stance migration shows early movers pulling the middle. Watch the escalation chains in the appendix; two of them began as single negative posts that gained organic amplification within one round.`,
    risks,
    confidence: {
      strongSignals: [`Sentiment toward ${topEntity} is ${direction} with consistent per-round movement`, `Engagement concentrated on a small set of high-salience personas (see leaderboards)`],
      contested: ["Casual-archetype personas split on the change — their sentiment did not converge", "Reddit and twitter reactions diverged on severity, not direction"],
    },
  };
}

// --- misc ------------------------------------------------------------------------
export function parseToolResult(res) {
  const text = res?.content?.[0]?.text;
  return JSON.parse(text);
}
