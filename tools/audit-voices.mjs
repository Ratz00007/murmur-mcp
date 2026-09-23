/** Audit voices.mjs templates for sentiment-lexicon coverage. */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
const MURMUR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "murmur");
const { VOICES } = await import(pathToFileURL(path.join(MURMUR, "tests/helpers/voices.mjs")).href);

const POS = ["love","great","amazing","excellent","impressive","win","solid","fair","trust","smooth","seamless","good","nice","reliable","hopeful","promising","delighted","perfect","genius","brilliant","affordable","generous","thanks","glad","happy","thrilled","elegant","intuitive","useful","improved","recommend","respected","underrated","killer","favorite","welcome","helpful"];
const NEG = ["hate","terrible","ripoff","overpriced","greedy","frustrating","unfair","scam","paywall","broken","worst","angry","churn","risky","worried","disappointing","sucks","trash","mess","shady","betrayal","expensive","frustrated","disappointed","outrage","backlash","cancel","cancelled","sketchy","misleading","locked","downgrade","chaos","delay","forced","mandatory","bait","buggy","slow","confusing","angry","awful","disaster","nightmare","garbage","lawsuit","outage"];

function polarity(t) {
  const s = t.toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (s.includes(w)) p++;
  for (const w of NEG) if (s.includes(w)) n++;
  return { p, n };
}

let weak = 0, total = 0;
for (const [key, v] of Object.entries(VOICES)) {
  const banks = [
    ["news.neg", v.news?.neg, "neg"], ["news.pos", v.news?.pos, "pos"], ["news.neutral", v.news?.neutral, "any"],
    ["fresh.neg", v.fresh?.neg, "neg"], ["fresh.pos", v.fresh?.pos, "pos"], ["fresh.neutral", v.fresh?.neutral, "any"],
    ["reply.agree", v.reply?.agree, "pos-ish"], ["reply.disagree", v.reply?.disagree, "any"],
    ["comment.neg", v.comment?.neg, "neg"], ["comment.pos", v.comment?.pos, "pos"],
  ];
  for (const [name, arr, want] of banks) {
    (arr || []).forEach((t, i) => {
      total++;
      const { p, n } = polarity(t);
      const hasNeg = n > 0, hasPos = p > 0;
      let bad = false;
      if (want === "neg" && !hasNeg) bad = true;
      if (want === "pos" && !hasPos) bad = true;
      if (want === "any" && (hasNeg || hasPos)) bad = "maybe"; // neutral banks shouldn't carry strong polarity
      if (bad) {
        weak++;
        console.log(`${bad === true ? "WEAK" : "POLAR"} ${key}.${name}[${i}] p=${p} n=${n} :: ${t.slice(0, 90)}`);
      }
    });
  }
}
console.log(`\n${weak} flagged of ${total} templates`);
