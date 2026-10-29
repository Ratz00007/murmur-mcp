/**
 * Numeric claim integrity.
 *
 * The report enforced citation integrity for post ids but trusted every NUMBER
 * in the narrative. `report.ts` told the model "never invent numbers" and
 * nothing checked it, so a draft could state any figure in the executive
 * summary, a finding, or a risk rationale and it would be rendered verbatim
 * into the dashboard a founder might screenshot into a board deck.
 *
 * These tests pin both directions: real figures are accepted, fabricated ones
 * are rejected, and the id-shaped tokens that used to trip a naive scanner
 * (po_12, r3, P10) are not mistaken for claims.
 */
import { describe, expect, it } from "vitest";
import { extractNumbers } from "../../packages/engine/src/report-claims.js";

describe("extractNumbers", () => {
  it("finds plain numbers", () => {
    const n = extractNumbers("We saw 24 posts and 312 likes");
    expect(n.map((x) => x.value)).toEqual([24, 312]);
  });

  it("treats post ids as identifiers, not claims", () => {
    // A naive scanner reads "12" out of po_12 and demands a run with exactly
    // 12 posts. That is how a citation-integrity check starts rejecting
    // correct drafts.
    const n = extractNumbers("Cited po_12 and ev_7 and p_3 in round r3");
    expect(n).toHaveLength(0);
  });

  it("treats persona handles as identifiers, not claims", () => {
    // Regression: a run containing a persona called @grace6 and a post author
    // u/ines8 produced the tokens "6" and "8", and the verifier rejected a
    // draft that was completely correct. Handles are interpolated straight into
    // the narrative, so this fires on any run with a digit in a handle.
    const n = extractNumbers(
      "Voices @grace6 and u/ines8 drove it; @elena4 replied",
    );
    expect(n).toHaveLength(0);
  });

  it("still finds a real number stated next to a handle", () => {
    const n = extractNumbers("@grace6 posted 14 times");
    expect(n.map((x) => x.value)).toEqual([14]);
  });

  it("does not treat ordinary words containing 'u' as handles", () => {
    // Regression: a `[@\/u]` character class matches a LITERAL u, so it
    // shredded "simulated" into "sim" + "ulated" and silently swallowed every
    // number after it. A verifier that drops numbers is worse than none.
    const n = extractNumbers(
      "Across this run 999999 simulated posts moved sentiment",
    );
    expect(n.map((x) => x.value)).toEqual([999999]);
  });

  it("finds numbers that follow ordinary u-words", () => {
    const n = extractNumbers("Users numbered 42 objected");
    expect(n.map((x) => x.value)).toEqual([42]);
  });

  it("ignores P10/P50/P90 band labels", () => {
    expect(extractNumbers("band P10 to P90")).toHaveLength(0);
  });

  it("ignores dates, times, and versions", () => {
    expect(
      extractNumbers("on 2026-06-15 at 08:00, version 1.2.3"),
    ).toHaveLength(0);
  });

  it("still finds real numbers next to ignored ones", () => {
    const n = extractNumbers(
      "See po_12: sentiment fell to -0.42 on 2026-06-15",
    );
    expect(n.map((x) => x.value)).toEqual([-0.42]);
  });

  it("parses thousands separators and negatives", () => {
    const n = extractNumbers("1,204 total and -17 net");
    expect(n.map((x) => x.value)).toEqual([1204, -17]);
  });
});
