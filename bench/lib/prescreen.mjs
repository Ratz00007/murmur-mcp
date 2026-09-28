/**
 * MurmurBench-0 — pre-screen, applied at candidate level during selection.
 *
 * PROTOCOL.md §4 requires that a thread "announces a specific, material
 * change to a product's price, licensing, API surface, or terms". The sealed
 * mechanical filters (is_self, >=10 comments, pre-seal) are necessary but not
 * sufficient: applied alone they admitted a freelancer ASKING how to price a
 * first gig, which is a question, not an announcement. This module applies
 * the semantic half of the rule.
 *
 * It reads the ANNOUNCEMENT ARTIFACT ONLY (title + body). It never reads a
 * comment. Every candidate gets a verdict and a logged reason.
 *
 * Timing: applied before ground-truth extraction and before either arm runs.
 * No objection content has been observed. Subreddit expansion was driven by
 * measured yield — comment counts and titles only.
 *
 * The core distinction: an announcement needs an announcement VERB. A bare
 * noun ("pricing") is what lets questions through, and a question mark in the
 * title is the strongest tell that a party is asking rather than announcing.
 */

/** A party acting on its own product: prices go up, features get removed. */
const ANNOUNCE_VERBS = [
  /\b(increas(?:e|ed|ing|es))\b/i,
  /\b(rais(?:e|es|ed|ing)|hike[ds]?|hiking|bump(?:ed|s|ing)?)\b/i,
  /\b(announc(?:e|ed|ing|es|ement))\b/i,
  /\b(unveil(?:ed|s|ing)?|introduc(?:e|ed|ing|ion))\b/i,
  /\b(deprecat(?:e|ed|ing|ion))\b/i,
  /\b(decommission(?:ed|ing)?|discontinu(?:e|ed|ing|ation))\b/i,
  /\b(sunset(?:s|ted|ting)?|shut(?:ting|s)?\s+down|phasing?\s+out|end(?:ed|ing|s)?\s+(?:support|free|service|the\s+free\s+tier))\b/i,
  /\b(revok(?:e|ed|ing)|withdraw(?:n|al|s)?|remov(?:e|ed|ing|al))\b/i,
  /\b(chang(?:e|ed|ing|es)\s+(?:to|our|the|its|their)\s+(?:pricing|price|prices|plan|plans|terms|licen[cs]e|licensing|api))\b/i,
  /\b(migrat(?:e|ed|ing|ion)\s+(?:to|from|away|off))\b/i,
  /\b(now\s+requires?|requiring|requires?\s+(?:an?\s+)?(?:api\s*key|paid|subscription|approval|login))\b/i,
  /\b(licen[cs]e\s+change|licen[cs]e\s+policy|pricing\s+change|price\s+(?:hike|increase|change|rise|adjustment))\b/i,
  /\b(we'?re\s+(?:moving|switching|migrating|upgrading|rolling\s+back|adding|removing))\b/i,
  /\b(adding\s+(?:telemetry|tracking|analytics))\b/i,
];

/** A party seeking input, not announcing a decision. */
const QUESTION_TELLS = [
  /\?\s*$/, // question mark
  /^(?:help|how|any\s?(?:one|body)|does\s+anyone|can\s+(?:i|someone|anyone)|what|why|is\s+it|am\s+i|should\s+i|where|anyone|anyone\s+else)\b/i,
  /\b(am\s+i\s+pricing|how\s+(?:do|should|can|would)\s+i|any\s+advice|thoughts\?|help\s+me|how\s+do\s+i|is\s+this\s+(?:right|fair|correct|overpriced))\b/i,
  /\b(should\s+i\s+(?:switch|move|stick|drop|cancel)|worth\s+(?:it|switching|it\s+to))\b/i,
];

/**
 * WHO is speaking. The protocol requires a party announcing a change to its
 * own users. A verb alone is not enough: real price-increase threads are full
 * of bystanders REACTING ("the price dropped $40", "is this expected?"), and
 * those bystanders are exactly the population we are trying to predict. Using
 * them as ground truth would be circular — the thread would mostly contain
 * people reacting, which is the very thing under test.
 *
 * So the artifact must read as first-party: the speaker is the vendor.
 */
const FIRST_PARTY = [
  /\b(we|our|us|i'?ve|my company|our customers|our users|our plan|our pricing|our users|as (?:a|an|the) (?:vendor|vendor|developer|publisher|maintainer|provider|seller|company))\b/i,
];
const VENDOR_SUBJECT = [
  /\b(we'?re|we\s+are|we\s+have)\s+(?:increasing|raising|deprecating|removing|adding|discontinuing|migrating|rolling\s+back|changing|updating|introducing|launching|announcing)\b/i,
  /\b(our|the)\s+(?:pricing|price\s+increase|plan|plans|api|terms|licen[cs]e|policy|free\s+tier|subscription)\b/i,
  /\b(announcing|introducing|effective\s+(?:immediately|on|starting)|starting\s+(?:on|january|february|march|april|may|june|july|august|september|october|november|december))\b/i,
  /\b(to\s+our\s+(?:customers|users|developers|plan|members|subscribers)|for\s+our\s+(?:customers|users|developers))\b/i,
  /\b(new\s+pricing|updated\s+(?:pricing|terms|licen[cs]e|policy)|pricing\s+update|price\s+increase\s+(?:is|will|applies|effective))\b/i,
];

/** Bystander tells: reacting, reporting, speculating, or self-promoting. */
const BYSTANDER = [
  /\b(price\s+(?:dropped|drop|fell|went\s+up\s+on|increased\s+on\s+my|is\s+\$\d+\s+now)|just\s+bought|i\s+bought|ordered\s+mine|cart)\b/i,
  /\b(credit\s+card|charged\s+me|refunded|no\s+charge)\b/i,
  /\b(does\s+(?:anyone|anybody)|has\s+anyone|anyone\s+else)\b/i,
  /\b(thoughts\?|any\s+advice|what\s+do\s+you\s+think|am\s+i\s+(?:wrong|right))\b/i,
  /\b(i\s+(?:built|created|made|launched|am\s+building)|my\s+(?:saas|product|tool|app|startup|company)|check\s+it\s+out|introducing\s+my)\b/i,
  /\b(deal|discount|coupon|promo\s?code|best\s+price|cheap(?:er)?\s+than)\b/i,
];

/**
 * @returns {{pass: boolean, reason: string|null}}
 *   reason is always populated on failure so every drop is explainable.
 */
export function screenAnnouncement(title, selftext = "") {
  const t = title ?? "";
  const body = selftext ?? "";
  const text = `${t}\n${body}`;

  const verb = ANNOUNCE_VERBS.find((rx) => rx.test(text));
  if (!verb) {
    return { pass: false, reason: "no_announcement_verb_in_artifact" };
  }

  // A question mark in the title, plus question phrasing in the body, means a
  // party is asking for advice rather than announcing a decision.
  if (/\?/.test(t) && QUESTION_TELLS.some((rx) => rx.test(text))) {
    return { pass: false, reason: "artifact_is_a_question_not_an_announcement" };
  }

  // A bystander reporting or speculating about someone else's change.
  if (BYSTANDER.some((rx) => rx.test(text))) {
    return { pass: false, reason: "speaker_is_a_bystander_not_the_vendor" };
  }

  // First-party voice: the speaker is the party making the change.
  const firstParty = FIRST_PARTY.some((rx) => rx.test(text));
  const vendorSubject = VENDOR_SUBJECT.some((rx) => rx.test(text));
  if (!firstParty || !vendorSubject) {
    return {
      pass: false,
      reason: !firstParty ? "not_first_party_voice" : "announcement_verb_without_a_vendor_subject",
    };
  }

  return { pass: true, reason: null, matched: String(verb) };
}
