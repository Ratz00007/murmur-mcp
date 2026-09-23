/**
 * Deterministic mock "host LLM" for tests, golden runs and the headless demo.
 * Plain ESM JavaScript so it can be imported by both vitest tests and plain
 * node scripts (.mjs) without a build step. Zero dependencies.
 *
 * It completes the four generation-task kinds with schema-valid content,
 * seeded by (task id + persona id) so identical runs replay identically.
 * Post content is generated from per-archetype voice packs (voices.mjs), so
 * simulated timelines read like real platform discourse instead of templates.
 */
import { VOICES, voiceFor, crudePolarity, TAGS } from "./voices.mjs";

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

// --- text helpers -------------------------------------------------------------
function fill(tpl, slots) {
  let out = String(tpl);
  for (const [k, v] of Object.entries(slots || {})) out = out.split(`{${k}}`).join(String(v));
  out = out.replace(/\{num\}/g, "the change").replace(/\{org2\}/g, "the alternatives").replace(/\{org\}/g, "the platform").replace(/\{topic\}/g, "this").replace(/\{frag\}/g, "this");
  return out;
}
function cap(s, n) {
  const t = String(s).trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  // prefer cutting at a sentence boundary over slicing mid-sentence
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (lastStop > Math.floor(n * 0.55)) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > Math.floor(n * 0.6) ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
function engagementScore(str) {
  return (String(str || "").match(/\d+/g) || []).reduce((a, x) => a + Number(x), 0);
}
function fragOf(r, body) {
  const words = String(body || "").replace(/["“”«»]/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= 5) return words.join(" ");
  const start = Math.floor(r() * Math.max(1, words.length - 5));
  return words.slice(start, start + 4 + Math.floor(r() * 2)).join(" ");
}

/** Word-boundary marker check mirroring the engine's lexical tokenizer. */
function hasMarker(text, words) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9'\- ]/g, " ").replace(/\s+/g, " ")} `;
  return words.some((w) => t.includes(` ${w} `));
}
const POS_WORDS = ["love", "loved", "great", "amazing", "excellent", "good", "nice", "helpful", "impressed", "impressive", "excited", "exciting", "win", "winning", "improved", "improve", "fair", "transparent", "best", "favorite", "recommend", "recommended", "glad", "happy", "thrilled", "solid", "reliable", "trust", "trusted", "respect", "genius", "brilliant", "clever", "affordable", "generous", "free", "promising", "hopeful", "welcome", "useful", "intuitive", "seamless", "smooth", "delight", "delighted", "perfect", "killer", "underrated", "champion"];
const NEG_WORDS = ["hate", "hated", "terrible", "awful", "worst", "bad", "broken", "buggy", "expensive", "overpriced", "paywall", "greedy", "scam", "lie", "lying", "lied", "disappointed", "disappointing", "frustrated", "frustrating", "unfair", "backlash", "angry", "outrage", "ripoff", "shady", "sketchy", "worried", "worry", "risky", "concerned", "sucks", "suck", "trash", "garbage", "disaster", "nightmare", "mess", "regression", "forced", "mandatory", "churn", "betrayal"];

/** Pull the most quotable number out of a news line ("40%" beats "3"). */
function newsNumber(line) {
  const nums = String(line || "").match(/\d+(?:\.\d+)?%|\d+(?:\.\d+)?/g) || [];
  const pct = nums.find((n) => n.endsWith("%"));
  if (pct) return pct;
  const big = nums.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => b - a)[0];
  if (big !== undefined && big >= 10) return String(big);
  return nums[0] || "";
}

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
  const STOP = new Set(
    "the a an and or but if while of to in on for with without at by from as is are was were be been this that these those it its we you they he she i our your their not no nor so than then there here what which who when where why how all any both each few more most other some such only own same too very will just don should now about into over after before under above out off again once does did doing have has had would could may might must shall also however therefore per via etc get got make made use used using one two three new like due within across between because during through against among upon".split(
      " "
    )
  );
  for (const p of phrases) {
    if (!seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      candidates.push(p);
    }
  }
  const properCount = candidates.length; // proper-noun phrases (capitalized in text)
  // bigram pass: frequent two-word sequences ("pricing change", "free tier")
  // become topic entities — more meaningful than their single words alone
  const wordSeq = allText.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [];
  const bigrams = new Map();
  for (let i = 0; i < wordSeq.length - 1; i++) {
    const a = wordSeq[i];
    const b = wordSeq[i + 1];
    if (STOP.has(a) || STOP.has(b)) continue;
    const key = `${a} ${b}`;
    bigrams.set(key, (bigrams.get(key) || 0) + 1);
  }
  for (const [bg] of [...bigrams.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (!seen.has(bg)) {
      seen.add(bg);
      candidates.push(bg.replace(/(^| )[a-z]/g, (m) => m.toUpperCase()));
    }
  }
  // then frequent single keywords, in quality tiers:
  //   tier A — freq >= 2, not generic (domain-specific mentions)
  //   tier B — freq == 1, not generic, in order of first appearance (early = salient)
  //   tier C — freq >= 2 but generic filler (existing, plans, platform, ...),
  //            only used to top the ontology up
  const freq = new Map();
  const firstAt = new Map();
  let pos = 0;
  for (const w of allText.toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    if (!freq.has(w)) firstAt.set(w, pos);
    freq.set(w, (freq.get(w) || 0) + 1);
    pos++;
  }
  const GENERIC = new Set(
    "existing plans platform segment enterprise customers teams projects company people price prices community support page pages tool tools guide week weeks month months year years quarter day days time work works thing things stuff today tomorrow everyone someone anything".split(
      " "
    )
  );
  const insideAccepted = (w) => {
    const wl = w.toLowerCase();
    const singular = wl.endsWith("s") && wl.length > 4 ? wl.slice(0, -1) : wl + "s";
    return candidates.some((c) => {
      const words = c.toLowerCase().split(/\s+/);
      return words.includes(wl) || words.includes(singular);
    });
  };
  const addWord = (w) => {
    const t = w[0].toUpperCase() + w.slice(1);
    const wl = w.toLowerCase();
    const singular = wl.endsWith("s") && wl.length > 4 ? wl.slice(0, -1) : wl + "s";
    if (seen.has(wl) || seen.has(singular) || insideAccepted(w)) return false;
    seen.add(wl);
    seen.add(singular);
    candidates.push(t);
    return true;
  };
  const TARGET = 12;
  const entries = [...freq.entries()];
  const byFirstAppearance = (a, b) => (firstAt.get(a[0]) ?? 0) - (firstAt.get(b[0]) ?? 0);
  // tier A: frequent and domain-specific
  for (const [w, n] of entries.filter(([fw, fn]) => fn >= 2 && !GENERIC.has(fw)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (candidates.length >= TARGET) break;
    addWord(w);
  }
  // tier B: rare-but-meaty scenario nouns (uptime, changelog, amnesty, ...)
  // — length >= 6, no verb/adverb shapes, longest first (specific beats vague)
  const VERBISH = new Set(
    "migrate published announced launched offering doubled shipped argues defends posted calling shrinks reads pinned threatens points calls notes grew drove mentions remains drew drop wants keep kept said says argued undercuts keeps sees ships drops offers undercuts argues notes plans threatens drives drove driven spikes pinned posted calls defends defends".split(
      " "
    )
  );
  for (const [w] of entries
    .filter(([fw, fn]) => fn === 1 && !GENERIC.has(fw) && fw.length >= 6 && !fw.includes("-") && !/(ly|ing|ed|s)$/.test(fw) && !VERBISH.has(fw))
    .sort((a, b) => b[0].length - a[0].length || (firstAt.get(a[0]) ?? 0) - (firstAt.get(b[0]) ?? 0))) {
    if (candidates.length >= TARGET) break;
    addWord(w);
  }
  // tier C: generic-but-recurring fillers, least-bad option to reach a full ontology
  for (const [w, n] of entries.filter(([fw, fn]) => fn >= 2 && GENERIC.has(fw)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (candidates.length >= TARGET) break;
    addWord(w);
  }
  // classify by name shape: a pricing plan or policy is a topic the crowd
  // argues about, not an organization that announces things; only brand-shaped
  // names (suffix cues like "Labs", "Cloud", "Inc") become orgs. This keeps
  // news templates from rendering "Pricing Release announces..." nonsense.
  const ORG_SHAPE = /(labs?|cloud|inc|corp|llc|technolog(y|ies)|systems?|software|studios?|group|solutions|networks?|media|works|hardware|devices|ai)$/i;
  const ABSTRACT = /(pricing|price|plan|tier|subscription|billing|payment|refund|amnesty|grandfather|policy|backlash|narrative|adoption|migration|lock-?in|limit|quota|uptime|sla|reliability|observability|export|community|customer|user|free|changelog|faq|guide|page|support|onboard|seat|renewal)/i;
  const classify = (name, isProper, i) => {
    if (ORG_SHAPE.test(name)) return "org";
    if (ABSTRACT.test(name)) return "topic";
    if (isProper) return i % 2 === 0 ? "product" : "org"; // brand-shaped proper nouns
    return ["topic", "idea", "topic", "idea", "topic"][i % 5];
  };
  const motiveFor = (name, type) => {
    const r = rng(`m:${name}`);
    if (type === "org") return `${name} wants to ${pick(r, ["grow adoption", "protect revenue", "avoid backlash", "shape the narrative", "keep users loyal", "move fast without breaking trust"])}`;
    if (type === "product") return `${name} needs to ${pick(r, ["prove its value fast", "keep its reliability record", "convert curious users", "earn renewal pricing", "outbuild the alternative"])}`;
    if (type === "idea") return `the crowd reads ${name} as ${pick(r, ["a fairness test", "a trust decision", "value versus lock-in", "a switching-cost question"])}`;
    return `the debate around ${name} turns on ${pick(r, ["value versus lock-in", "who pays for reliability", "fairness to early users", "short-term pain against long-term trust"])}`;
  };
  const sentences = allText.split(/(?<=[.!?])\s+/);
  const entities = candidates.slice(0, 14).map((name, i) => {
    const re = new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i");
    const anchors = sentences.filter((s) => re.test(s)).slice(0, 2).map((s) => s.trim().slice(0, 220));
    const type = classify(name, i < properCount, i);
    return {
      name,
      type,
      description: `${name} appears repeatedly across the source material and shapes the scenario.`,
      salience: Math.round((0.9 - i * 0.045) * 100) / 100,
      anchors,
      motives: [motiveFor(name, type)],
    };
  });
  return { entities };
}

// --- personas -----------------------------------------------------------------
const NAMES = [
  "Ada Okafor", "Ben Sørensen", "Cara Lindqvist", "Dev Patel", "Elena Rossi", "Felix Moreau",
  "Grace Kim", "Hugo Álvarez", "Ines Duarte", "Jonas Weber", "Kira Novak", "Liam Byrne",
  "Maya Chandra", "Noah Fischer", "Olivia Santos", "Pavel Horak", "Quinn Ashworth", "Rosa Delgado",
  "Samir Haddad", "Tessa Jansen", "Umar Diallo", "Vera Petrova", "Willem Bosch", "Xiu Chen",
  "Yara Nasser", "Zach Vogel", "Anya Iversen", "Bruno Costa", "Clara Nyberg", "Dmitri Volkov",
  "Emi Tanaka", "Farah Nazari",
];

export function completePersonas(task) {
  const pop = task.items[0].payload.population;
  const count = pop.count;
  const archetypes = pop.archetypes.map((a) => a.name);
  const allEntities = pop.entities || [];
  // stances go to organization-like entities first (the actors personas react
  // to in news), topped up with the most salient topics — keeps news templates
  // from rendering as "Pricing announces..."
  const orgish = allEntities.filter((e) => ["org", "product", "person"].includes(e.type) || String(e.name).includes(" ") || /[a-z][A-Z]/.test(e.name));
  const entities = (orgish.length >= 3 ? orgish : allEntities).slice(0, 5);
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
function bucketOf(stance) {
  if (stance <= -0.4) return "neg";
  if (stance <= -0.15) return "neg";
  if (stance >= 0.4) return "pos";
  if (stance >= 0.15) return "pos";
  return "neutral";
}
function stanceToward(stances, name) {
  const s = stances.find(([n]) => n === name);
  return s ? s[1] : 0;
}
/** Organization-like entity names: multi-word, CamelCase, or org-suffixed. */
function orgish(name) {
  const n = String(name || "");
  return n.includes(" ") || /[a-z][A-Z]/.test(n) || /\b(Labs|Cloud|Inc|Corp|Works|Systems|Technologies|HQ|AI|Soft|Hub|Stack)\b/.test(n);
}
function entityInBody(stances, body) {
  const b = String(body || "").toLowerCase();
  let first = null;
  for (const [n] of stances) {
    if (b.includes(n.toLowerCase())) {
      if (orgish(n)) return n; // prefer org-like mentions ("Acme Cloud" over "pricing")
      if (first === null) first = n;
    }
  }
  return first;
}
function dress(r, voice, core, traits, round, hasMemory, bucket) {
  let out = core;
  const hot = (traits.extraversion ?? 0.5) > 0.65;
  // polarity safety net: if the drawn template carries no sentiment marker,
  // sign the post with a natural tag line so lexical attribution stays honest
  if (bucket === "neg" && !hasMarker(out, NEG_WORDS) && !hasMarker(out, POS_WORDS)) {
    out = `${out} ${pick(r, TAGS.neg)}`;
  } else if (bucket === "pos" && !hasMarker(out, POS_WORDS)) {
    out = `${out} ${pick(r, TAGS.pos)}`;
  }
  if (hasMemory && round >= 3 && r() < 0.3) {
    out = `${pick(r, ["Update from my last post:", "Following up from earlier:", "Round " + round + " and I still stand by it —"])} ${out}`;
  } else if (r() < 0.18) {
    out = `${pick(r, ["Ok hear me out:", "PSA:", "Unpopular opinion:", "Screaming into the void but:", "Actually important:"])} ${out}`;
  }
  if (r() < 0.3 && voice.closers && voice.closers.length > 0) {
    out = `${out} ${pick(r, voice.closers)}`;
  }
  if (hot && r() < 0.55 && out.endsWith(".")) out = out.slice(0, -1) + "!";
  return out;
}

export function completeSim(task) {
  const out = [];
  const round = task.round ?? 1;
  for (const item of task.items) {
    const d = item.payload;
    const p = d.persona;
    const r = rng(`${task.id}:${p.id}`);
    const actions = [];
    const traits = Object.fromEntries((p.traits || []).map(([k, v]) => [k, v]));
    const voice = VOICES[voiceFor(p.archetype)] ?? VOICES.professional;
    const stances = (p.stances || []).slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const top = stances[0];
    const second = stances[1];
    const canTw = p.platform !== "reddit";
    const canRd = p.platform !== "twitter";
    const memory = (d.memory && d.memory.recent) || [];
    const feed = ((d.feed || []).filter((f) => f.id && f.body) || [])
      .map((f) => ({ ...f, score: engagementScore(f.engagement) }))
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

    // low-activity personas sometimes lurk the round away
    if ((p.activity ?? 0.5) < 0.35 && r() < 0.3) {
      out.push({ persona: p.id, actions: [] });
      continue;
    }

    // 1) react to injected news — the moment that defines the round
    const events = (d.collective && d.collective.events) || [];
    let reacted = false;
    if (events.length > 0 && top) {
      const ev = String(events[0]).replace(/<\/?event>/g, "").replace(/^r\d+:\s*/i, "");
      const num = newsNumber(ev);
      const orgs = stances.map(([n]) => n).filter((n) => ev.toLowerCase().includes(n.toLowerCase()) && orgish(n));
      const pushPost = (body, titleTopic) => {
        if (canRd && (p.platform === "reddit" || (p.platform === "both" && r() < 0.4))) {
          actions.push({
            type: "post",
            platform: "reddit",
            title: cap(fill(pick(r, voice.titles), { topic: titleTopic }), 130),
            body,
          });
        } else if (canTw) {
          actions.push({ type: "post", platform: "twitter", body: cap(body, 270) });
        } else {
          return;
        }
        reacted = true;
      };
      // undercut shape: "{attacker} undercuts {victim} by N%" — dedicated banks
      // so supporters of either side frame the event correctly (and each bank
      // mentions only one org, keeping sentiment attribution clean)
      const undercutM = ev.match(/undercuts?\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*)?)/);
      if (!reacted && undercutM && voice.newsUndercut && orgs.length >= 2 && r() < 0.85) {
        const victimRaw = undercutM[1].toLowerCase();
        const victim = orgs.find((n) => victimRaw.startsWith(n.split(" ")[0].toLowerCase()) || n.toLowerCase().includes(victimRaw));
        const attacker = orgs.find((n) => n !== victim);
        if (victim && attacker) {
          const likesIt = stanceToward(stances, attacker) > stanceToward(stances, victim);
          const bank = voice.newsUndercut[likesIt ? "pos" : "neg"] || voice.newsUndercut.pos;
          const core = dress(r, voice, fill(pick(r, bank), { org: victim, org2: attacker, num: num || "the", topic: likesIt ? attacker : victim }), traits, round, memory.length > 0, "pos");
          pushPost(core, likesIt ? attacker : victim);
        }
      }
      // general news shape: react to {org} based on stance toward it
      if (!reacted) {
        let org = null;
        let orgStance = 0;
        for (const name of orgs) {
          org = name;
          orgStance = stanceToward(stances, name);
          if (Math.abs(orgStance) >= 0.15) break;
        }
        if (org && Math.abs(orgStance) >= 0.15 && r() < 0.85) {
          const bucket = bucketOf(orgStance);
          const orgishSecond = stances.find(([n, v]) => n !== org && orgish(n) && Math.abs(v) >= 0.1);
          const core = dress(r, voice, fill(pick(r, voice.news[bucket] || voice.news.neutral), { org, org2: orgishSecond ? orgishSecond[0] : "the alternatives", num: num || "the change", topic: org }), traits, round, memory.length > 0, bucket);
          pushPost(core, org);
        }
      }
    }

    // 2) engage the feed — replies, quotes, comments, votes
    const usable = feed.filter((f) => (f.plat === "tw" && canTw) || (f.plat === "rd" && canRd));
    if (usable.length > 0 && !reacted && r() < 0.85) {
      const target = usable[Math.floor(r() * Math.min(usable.length, 4)) % usable.length];
      const parentEntity = entityInBody(stances, target.body);
      const myStance = parentEntity ? stanceToward(stances, parentEntity) : top ? top[1] * 0.5 : 0;
      const pol = crudePolarity(target.body);
      const aligned = myStance * pol > 0 || (pol === 0 && myStance >= 0);
      const frag = fragOf(r, target.body);
      const topic = parentEntity ?? (top ? top[0] : "this");
      if (target.plat === "tw") {
        const roll = r();
        const replyBucket = aligned ? "pos" : "neg";
        if (aligned && roll < 0.3) {
          actions.push({ type: "like", parent: target.id });
        } else if (roll < 0.35) {
          // quote-dunk or quote-boost
          const bank = aligned ? voice.reply.agree : voice.reply.disagree;
          actions.push({ type: "quote", parent: target.id, body: cap(dress(r, voice, fill(pick(r, bank || voice.reply.neutral), { frag, topic }), traits, round, memory.length > 0, replyBucket), 270) });
        } else {
          const bank = aligned ? voice.reply.agree : voice.reply.disagree;
          actions.push({ type: "reply", parent: target.id, body: cap(dress(r, voice, fill(pick(r, bank || voice.reply.neutral), { frag, topic }), traits, round, memory.length > 0, replyBucket), 270) });
        }
      } else {
        const roll = r();
        if (aligned && roll < 0.3) {
          actions.push({ type: "upvote", parent: target.id });
        } else if (!aligned && roll < 0.25) {
          actions.push({ type: "downvote", parent: target.id });
        } else {
          const bank = aligned ? voice.comment.pos : voice.comment.neg;
          actions.push({ type: "comment", parent: target.id, body: cap(dress(r, voice, fill(pick(r, bank || voice.comment.neutral), { frag, topic }), traits, round, memory.length > 0, aligned ? "pos" : "neg"), 900) });
        }
      }
      reacted = true;
    }

    // 3) fresh standalone take
    if (actions.length === 0 && top && r() < 0.75) {
      const bucket = bucketOf(top[1]);
      const orgishAlt = stances.find(([n, v]) => n !== top[0] && orgish(n) && Math.abs(v) >= 0.1);
      const slots = { topic: top[0], org: top[0], org2: orgishAlt ? orgishAlt[0] : "the alternatives", num: "the change" };
      const core = fill(pick(r, voice.fresh[bucket] || voice.fresh.neutral), slots);
      if (canRd && (p.platform === "reddit" || (p.platform === "both" && r() < 0.35))) {
        actions.push({ type: "post", platform: "reddit", title: cap(fill(pick(r, voice.titles), { topic: top[0] }), 130), body: dress(r, voice, core, traits, round, memory.length > 0, bucket) });
      } else if (canTw) {
        actions.push({ type: "post", platform: "twitter", body: cap(dress(r, voice, core, traits, round, memory.length > 0, bucket), 270) });
      }
    }

    // 4) occasionally a second lightweight interaction with a different target
    if (actions.length === 1 && usable.length > 1 && r() < 0.4) {
      const other = usable.find((f) => f.id !== (actions[0].parent ?? actions[0].parent ?? actions[0])) ?? usable[1];
      if (other && other.id !== actions[0].parent) {
        const parentEntity = entityInBody(stances, other.body);
        const myStance = parentEntity ? stanceToward(stances, parentEntity) : 0;
        const pol = crudePolarity(other.body);
        if (other.plat === "tw" && canTw && myStance * pol > 0) actions.push({ type: "like", parent: other.id });
        else if (other.plat === "rd" && canRd) actions.push({ type: myStance * pol > 0 ? "upvote" : "downvote", parent: other.id });
      }
    }

    out.push({ persona: p.id, actions: actions.slice(0, 3) });
  }
  return out;
}

// --- report ---------------------------------------------------------------------
const n2 = (v) => (v === null || v === undefined ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(2));
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

export function completeReportTask(task) {
  const payload = task.items[0].payload || {};
  const stats = payload.stats || {};
  const evidence = payload.evidence || [];
  const rounds = stats.rounds || [];
  const last = rounds[rounds.length - 1] || { engagement: 0, sentimentByEntity: {} };
  const f = (stats.factions && stats.factions.factions) || [];
  const sup = f.find((x) => x.key === "supporters");
  const opp = f.find((x) => x.key === "opponents");
  const und = f.find((x) => x.key === "undecided");
  const focusName = (stats.factions && stats.factions.focusEntity) || "the scenario";
  const polarization = (stats.factions && stats.factions.polarization) || 0;
  const controversy = stats.controversy || { score: 0, label: "unmeasured", drivers: [] };
  const mom = stats.momentum || { trend: "steady", pct: 0 };
  const proj = stats.projection;
  const cross = stats.crossPlatform || { totals: {}, rows: [], maxDivergence: null };
  const amp = stats.amplification || { viralPosts: [], organicEngagementShare: 0 };
  const trends = stats.entityTrends || [];
  const chains = stats.escalationChains || [];
  const topPosts = stats.topPosts || [];
  const injections = rounds.reduce((a, r) => a + (r.injections || 0), 0);
  const totalPosts = stats.totalPosts ?? rounds.reduce((a, r) => a + r.twitter + r.reddit, 0);
  const totalEngagement = stats.totalEngagement ?? rounds.reduce((a, r) => a + r.engagement, 0);
  const focusTrend = trends.find((t) => t.entity === focusName) || trends[0] || { first: null, last: null, delta: null, direction: "flat" };
  const directionWord =
    focusTrend.delta === null || focusTrend.delta === undefined ? "untracked" : focusTrend.delta < -0.05 ? "souring" : focusTrend.delta > 0.05 ? "warming" : "holding steady";

  // ---- evidence helpers ------------------------------------------------------
  const evPosts = (i) => (evidence[i] && evidence[i].posts) || [];
  const postIdsFrom = (arr, n) =>
    arr
      .slice()
      .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment) || String(a.id).localeCompare(String(b.id)))
      .slice(0, n)
      .map((x) => x.id);
  const fallbackIds = (n) => topPosts.slice(0, n).map((x) => x.id);

  // ---- risks -------------------------------------------------------------------
  const risks = [];
  // R1: sentiment hardening around the loudest entity cluster — prefer the
  // polarity that matches the dominant faction (backlash for majority-negative
  // crowds, hype for majority-positive ones)
  const majorityNeg = (opp ? opp.size : 0) >= (sup ? sup.size : 0);
  const cluster = evidence
    .map((e, i) => ({ entity: e.entity, posts: evPosts(i) }))
    .filter((c) => c.posts.length >= 2)
    .sort((a, b) => {
      const sa = a.posts.filter((p) => (majorityNeg ? (p.sentiment || 0) < 0 : (p.sentiment || 0) > 0)).length;
      const sb = b.posts.filter((p) => (majorityNeg ? (p.sentiment || 0) < 0 : (p.sentiment || 0) > 0)).length;
      if (sb !== sa) return sb - sa;
      return Math.max(...b.posts.map((p) => Math.abs(p.sentiment || 0))) - Math.max(...a.posts.map((p) => Math.abs(p.sentiment || 0)));
    });
  const r1c = cluster[0];
  if (r1c) {
    const alignedPosts = r1c.posts.filter((p) => (majorityNeg ? (p.sentiment || 0) < 0 : (p.sentiment || 0) > 0));
    const strongest = (alignedPosts.length > 0 ? alignedPosts : r1c.posts).slice().sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment))[0];
    // evidence ids must match the risk's polarity: a backlash risk never
    // cites a glowing endorsement as its evidence — fill the third slot with
    // aligned posts only, or leave it at two rather than break polarity
    const alignedSorted = (alignedPosts.length > 0 ? alignedPosts : r1c.posts)
      .slice()
      .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment) || String(a.id).localeCompare(String(b.id)));
    let r1Ids = alignedSorted.slice(0, 3).map((x) => x.id);
    if (r1Ids.length < 2) {
      r1Ids = [...alignedSorted, ...r1c.posts.filter((p) => !alignedSorted.includes(p))].slice(0, 3).map((x) => x.id);
    }
    const negative = (strongest.sentiment || 0) < 0;
    const sev = Math.abs(strongest.sentiment || 0) > 0.45 && (opp ? opp.size : 0) >= Math.max(2, ((sup && sup.size) || 0)) ? "high" : Math.abs(strongest.sentiment || 0) > 0.3 ? "medium" : "low";
    const r1Count = negative ? (opp && opp.size) || 0 : (sup && sup.size) || 0;
    risks.push({
      title: `${negative ? "Backlash" : "Hype"} hardening around ${r1c.entity}`,
      rationale: `Across ${rounds.length} rounds, posts about ${r1c.entity} clustered at sentiment ${n2(strongest.sentiment)} (strongest: ${strongest.id} by ${strongest.by}, engagement ${strongest.engagement ?? 0}), and ${r1Count} of ${stats.population} personas now ${r1Count === 1 ? "sits" : "sit"} ${negative ? "in opposition" : "in support"}. ${negative ? `Organic engagement amplified the negative cluster — ${amp.organicEngagementShare ? pct(amp.organicEngagementShare) + " of all engagement came from bystanders" : "bystander engagement is still forming"}.` : `The supportive cluster is collecting engagement faster than the critics (${sup ? sup.engagement : 0} vs ${opp ? opp.engagement : 0}), which hardens the champion narrative.`} If this pattern survives contact with the real launch, it becomes the default framing within days.`,
      severity: sev,
      likelihood: controversy.score >= 45 ? "high" : controversy.score >= 25 ? "medium" : "low",
      mitigation: negative
        ? `Pre-empt the frame with specifics, not reassurance: publish the grandfathering calculator, name the amnesty terms, and put the FAQ in front of the ${opp && opp.leaders && opp.leaders[0] ? opp.leaders[0].handle : "loudest critic"} cohort on their platform within 48 hours.`
        : `Bank the goodwill: arm the ${sup && sup.leaders && sup.leaders[0] ? sup.leaders[0].handle : "top advocate"} cohort with early access and migration proof-points before the wider rollout, so the champion narrative carries data instead of vibes.`,
      trigger: negative
        ? `The same complaint phrased identically in 2+ independent threads — that is the moment a grievance becomes a movement.`
        : `Champion posts out-earning critical posts by 3:1 for two consecutive cycles — that is complacency fuel.`,
      postIds: r1Ids,
    });
  }
  // R2: escalation contagion
  const chain = chains[0];
  if (chain && chain.path && chain.path.length >= 2) {
    risks.push({
      title: `Escalation chain ${chain.path[0]} can jump platforms`,
      rationale: `The run recorded a ${chain.depth}-deep escalation chain ending at sentiment ${n2(chain.finalSentiment)} (severity ${Number(chain.severity).toFixed(2)}). Threads like this are rehearsal: once the crowd learns that intensity earns replies, the same dynamic replays wherever the topic lands next — ${cross.totals.twitterEscalations || 0} chains rooted on Twitter vs ${cross.totals.redditEscalations || 0} on Reddit this run. The chain began at ${chain.path[0]} and recruited a new voice at every step.`,
      severity: chain.severity >= 2.5 ? "high" : chain.severity >= 1.5 ? "medium" : "low",
      likelihood: mom.trend === "accelerating" ? "high" : "medium",
      mitigation: `Draft the official response before round one of the real launch: a pinned reply template for the hottest threads, an owner named for each platform, and a rule that any thread crossing depth 3 gets a human answer within the hour.`,
      trigger: `A single thread reaching depth 3 with rising negative sentiment per step — that is the contagion signature this run demonstrated.`,
      postIds: chain.path.slice(0, 3),
    });
  }
  // R3: platform split (or complacency fallback)
  const div = cross.maxDivergence;
  if (div && div.value >= 0.15) {
    // evidence: posts about the entity the platforms actually disagree on,
    // one per venue where possible — not the run's generic top posts
    const divPosts = (((evidence.find((e) => e.entity === div.entity) || {}).posts) || [])
      .slice()
      .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment) || String(a.id).localeCompare(String(b.id)));
    const twPick = divPosts.find((p) => p.plat === "tw");
    const rdPick = divPosts.find((p) => p.plat === "rd" && p.id !== (twPick || {}).id);
    let ids = twPick && rdPick ? [twPick.id, rdPick.id] : divPosts.slice(0, 2).map((p) => p.id);
    if (ids.length < 2) ids = ids.concat(topPosts.slice(0, 2).map((p) => p.id)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2);
    risks.push({
      title: `Platform-split narrative on ${div.entity}`,
      rationale: `The same story is landing differently by venue: ${div.entity} reads ${n2((cross.rows || []).find((x) => x.entity === div.entity)?.twitter)} on Twitter versus ${n2((cross.rows || []).find((x) => x.entity === div.entity)?.reddit)} on Reddit (divergence ${Number(div.value).toFixed(2)}). Cross-posted screenshots let the angrier venue set the frame for both, and the calmer venue's arguments never catch up — the run's escalation chains concentrated where the heat was.`,
      severity: div.value >= 0.35 ? "high" : "medium",
      likelihood: "medium",
      mitigation: `Run the venues as separate campaigns: long-form receipts where the skepticism lives (Reddit), fast empathy where the heat lives (Twitter). Never answer a Reddit thread with a Twitter screenshot.`,
      trigger: `Cross-platform screenshots of the same quote framed by opposite narratives — the split going public.`,
      postIds: ids.length >= 2 ? ids : fallbackIds(2),
    });
  } else {
    const p = topPosts[0];
    risks.push({
      title: `Engagement concentration around ${p ? p.by : "a single voice"}`,
      rationale: `Engagement concentrated on a handful of voices this run — the top post (${p ? p.id : "—"}, by ${p ? p.by : "—"}, sentiment ${p ? n2(p.sentiment) : "—"}, engagement ${p ? p.engagement : 0}) anchored the round it landed in. Concentrated attention means one more post from the same voice can re-set the topic's framing for everyone else.`,
      severity: "medium",
      likelihood: "medium",
      mitigation: `Map the top five voices by engagement and engage them directly — early access, a real answer, or a public concession. Their next post decides whether concentration works for you.`,
      trigger: `The same handle topping two consecutive rounds — that is a narrative owner emerging.`,
      postIds: fallbackIds(3).length >= 2 ? fallbackIds(3) : (p ? [p.id] : []).concat(fallbackIds(1)),
    });
  }
  while (risks.length < 3) {
    const p = topPosts[risks.length] || topPosts[0];
    if (!p) break;
    // the anchor plus what else was hot in its round — a cohort, not random top posts
    const sameRound = topPosts.filter((x) => x.round === p.round && x.id !== p.id).slice(0, 2).map((x) => x.id);
    const ids = [p.id, ...sameRound, ...fallbackIds(3)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
    risks.push({
      title: `Unmuted cluster around ${p.by}'s ${p.plat === "tw" ? "tweet" : "post"}`,
      rationale: `Post ${p.id} (round ${p.round}, sentiment ${n2(p.sentiment)}, engagement ${p.engagement}) keeps resurfacing in feeds across the run. High-salience anchors like this survive their news cycle and quietly set baselines for every later conversation about the same topic.`,
      severity: p.engagement >= 4 ? "medium" : "low",
      likelihood: "medium",
      mitigation: `Answer the post directly and publicly — a considered reply to the anchor outperforms broadcast messaging for this crowd, and starves the thread of the silence it feeds on.`,
      trigger: `The anchor post being quoted by a handle with no prior stance on the topic — neutral reach turning partisan.`,
      postIds: ids,
    });
  }

  // ---- narrative sections --------------------------------------------------------
  const supShare = sup ? sup.share : 0;
  const oppShare = opp ? opp.share : 0;
  const scenarioRecap =
    `Simulated ${stats.population} personas across ${stats.entityCount} ontology entities for ${rounds.length} rounds of dual-platform mechanics` +
    `${injections > 0 ? `, with ${injections} injected news event${injections === 1 ? "" : "s"} stress-testing the reaction` : ""}. ` +
    `The population split ${sup ? sup.size : 0} supporters vs ${opp ? opp.size : 0} opponents (${und ? und.size : 0} undecided) around ${focusName}, producing ${totalPosts} posts and ${totalEngagement} engagement events.`;

  const executiveSummary =
    `The simulated crowd is ${controversy.label} (controversy ${controversy.score}/100): ${sup ? sup.size : 0} supporters against ${opp ? opp.size : 0} opponents around ${focusName}, with ${und ? und.size : 0} personas still undecided — the persuadable middle is ${pct(und ? und.share : 0)} of the population. ` +
    `Sentiment toward ${focusName} ended ${n2(focusTrend.last)} (from ${n2(focusTrend.first)}, ${directionWord}); engagement is ${mom.trend} at ${mom.pct > 0 ? "+" : ""}${pct(mom.pct).replace("%", "")}% between halves of the run. ` +
    `${amp.viralPosts.length > 0 ? `${amp.viralPosts.length} post${amp.viralPosts.length === 1 ? "" : "s"} crossed the virality threshold and organic bystanders contributed ${pct(amp.organicEngagementShare)} of all engagement — the crowd is amplifying itself without prompting. ` : `No post crossed the virality threshold — reach stayed inside the follow graph, which limits how far any single frame can travel. `}` +
    `The strongest signal in the run is ${risks[0] ? risks[0].title.charAt(0).toLowerCase() + risks[0].title.slice(1) : "the sentiment cluster"}; the risk register below details what to do about it before this plays out in public.`;

  const keyFindings = [
    `The population split ${sup ? sup.size : 0}/${opp ? opp.size : 0}/${und ? und.size : 0} (support/oppose/undecided) — polarization ${Math.round(polarization * 100)}/100, controversy ${controversy.score}/100 (${controversy.label}).`,
    `Sentiment toward ${focusName} ran ${n2(focusTrend.first)} → ${n2(focusTrend.last)} over ${rounds.length} rounds (${directionWord}); peak discourse volume hit round ${trends.slice().sort((a, b) => b.volume - a.volume)[0]?.peakRound ?? rounds.length}.`,
    mom.trend !== "quiet"
      ? `Engagement is ${mom.trend} (${mom.pct > 0 ? "+" : ""}${pct(mom.pct)} second half vs first) — ${mom.trend === "accelerating" ? "the crowd is leaning in, not tuning out" : mom.trend === "cooling" ? "attention is decaying faster than sentiment is resolving" : "attention is stable while sentiment settles"}.`
      : `Engagement stayed low throughout — the scenario has not earned the crowd's adrenaline yet.`,
    amp.viralPosts.length > 0
      ? `${amp.viralPosts.length} viral post${amp.viralPosts.length === 1 ? "" : "s"} carried the run; organic bystanders supplied ${pct(amp.organicEngagementShare)} of engagement.`
      : `Zero viral posts: the run's reach is bounded by the follow graph — narratives are competing in a closed room.`,
  ];
  if (div && div.value >= 0.15) keyFindings.push(`Twitter and Reddit disagree most on ${div.entity} (Δ ${Number(div.value).toFixed(2)}) — the same facts are producing different verdicts per platform.`);

  const projected =
    proj && proj.projected && proj.projected.length > 0
      ? `The engine's least-squares extrapolation puts ${focusName} at ${proj.projected.map((x) => `${n2(x.value)} by round ${x.round}`).join(", ")} if nothing new lands (slope ${proj.slope > 0 ? "+" : ""}${proj.slope}/round, direction ${proj.direction}). `
      : `With too few rounds to extrapolate cleanly, the trend stays ${directionWord} rather than resolving. `;
  const trajectory =
    projected +
    `Momentum is ${mom.trend} (${mom.pct > 0 ? "+" : ""}${pct(mom.pct)}), so the near future is a tug-of-war between ${sup ? sup.size : 0} committed supporters and ${opp ? opp.size : 0} committed opponents over a ${und ? und.size : 0}-persona middle. ` +
    (chains.length > 0
      ? `${chains.length} escalation chain${chains.length === 1 ? "" : "s"} formed — each one a rehearsed playbook the crowd can reuse the moment real news lands. `
      : `No escalation chains formed — disagreement is staying flat instead of threading, which caps how fast either camp can recruit. `) +
    `The realistic branch: sentiment ${directionWord === "souring" ? "keeps drifting down as migration-friction posts compound" : directionWord === "warming" ? "continues improving as early adopters publish receipts" : "holds sideways while both camps argue"}, until the next injected event resets the board. Watch the triggers in the risk register — they are the earliest signals of which branch wins.`;

  const recommendations = [
    {
      title: "Answer the loudest cluster with specifics",
      action: `Take the strongest ${risks[0] && risks[0].severity === "high" ? "and most-cited" : ""} grievance thread head-on: publish the grandfathering math, name the amnesty terms, and route the FAQ to the critics' platform of choice within 48 hours of the real announcement.`,
      expectedImpact: `Converts a share of the ${pct(oppShare)} opposition before it hardens; historically blunts the first-week backlash curve.`,
    },
    {
      title: `Arm the ${sup && sup.leaders && sup.leaders[0] ? sup.leaders[0].handle : "champion"} cohort`,
      action: `Give the top supporters early access, migration proof-points and quotable numbers before the wider rollout — let the ${pct(supShare)} supporter base carry the narrative with evidence instead of enthusiasm.`,
      expectedImpact: `Raises organic positive amplification and gives undecided personas a data-backed alternative frame to adopt.`,
    },
    {
      title: "Instrument the triggers, not the sentiment",
      action: `Stand up monitoring for the three early-warning triggers in the risk register (repeated complaint phrasing, thread-depth escalation, cross-platform screenshot splits) with a named owner per platform and a one-hour response rule for anything firing.`,
      expectedImpact: `Catches the inflection points while they are still single threads — the simulation shows the crowd amplifies within one round.`,
    },
  ];

  const strongSignals = [
    `Sentiment toward ${focusName} is ${directionWord} with per-round consistency (${n2(focusTrend.first)} → ${n2(focusTrend.last)}).`,
    `Engagement concentrated on a small set of high-salience voices (${(stats.leaderboards || []).slice(0, 3).map((l) => l.handle).join(", ") || "see leaderboards"}).`,
  ];
  if (amp.viralPosts.length > 0) strongSignals.push(`${amp.viralPosts.length} viral post${amp.viralPosts.length === 1 ? "" : "s"} with ${pct(amp.organicEngagementShare)} organic engagement share — amplification is self-sustaining.`);
  if (chains.length > 0) strongSignals.push(`${chains.length} escalation chain${chains.length === 1 ? " was" : "s were"} recorded — disagreement reliably threads and intensifies.`);

  const contested = [
    und && und.size > 0
      ? `The undecided middle is ${pct(und.share)} of the population — the outcome hinges on which camp recruits them first.`
      : `Both camps are fully dug in with no undecided middle left — the next shift will come from outside events, not persuasion.`,
    div && div.value >= 0.15
      ? `Platforms diverge on ${div.entity} (Twitter ${n2((cross.rows || []).find((x) => x.entity === div.entity)?.twitter)} vs Reddit ${n2((cross.rows || []).find((x) => x.entity === div.entity)?.reddit)}) — severity is contested, not direction.`
      : `Casual-archetype personas did not converge — their sentiment stayed flat while committed personas hardened.`,
  ];

  const limitations = [
    `A ${stats.population}-persona simulation is directional, not a census; treat percentages as tendencies with wide error bars.`,
    `Sentiment is lexical over simulated text — irony and coded language can under- or over-score.`,
    `Extrapolations assume no new external events; real launches rarely get that courtesy.`,
  ];

  return {
    scenarioRecap,
    executiveSummary,
    keyFindings,
    trajectory,
    risks: risks.slice(0, 3),
    recommendations,
    confidence: { strongSignals, contested },
    limitations,
  };
}

// --- misc ------------------------------------------------------------------------
export function parseToolResult(res) {
  const text = res?.content?.[0]?.text;
  return JSON.parse(text);
}
