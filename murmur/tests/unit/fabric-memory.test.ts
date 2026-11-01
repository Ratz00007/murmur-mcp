/**
 * Persona memory log — appendMemory/getMemory as pure functions.
 *
 * The log is a value, not a store: append returns a NEW log and the input is
 * untouched, so there is nothing to lock and the server can swap the
 * reference atomically. The behavioral contract: a second interview after a
 * remember() reflects the remembered statement, deterministically and
 * identically on every repeat.
 */
import { describe, expect, it } from "vitest";
import {
  TRAIT_COUNT,
  appendMemory,
  fabricate,
  fit as fitSurrogate,
  getMemory,
  lazyPersona,
  mulberry32,
  type FabricExample,
} from "@murmur/engine";

function examples(count = 300): FabricExample[] {
  const rng = mulberry32(90210);
  const out: FabricExample[] = [];
  for (let i = 0; i < count; i++) {
    const traits = Array.from({ length: TRAIT_COUNT }, () => rng());
    const price = traits[0];
    out.push({
      traits,
      claimId: "support-tier",
      support: price < 0.5 ? 1 : 0,
      objectionId: "cost",
      choiceId: price > 0.5 ? "switch" : "stay",
    });
  }
  return out;
}

describe("persona memory log", () => {
  it("appends without mutating the input log (pure functions)", () => {
    const original = appendMemory([], "#1", "first entry");
    const snapshot = JSON.stringify(original);
    const updated = appendMemory(original, "#1", "second entry");
    expect(JSON.stringify(original)).toBe(snapshot); // input untouched
    expect(updated).toHaveLength(2);
    expect(updated[1].seq).toBe(2);
    expect(updated[1].text).toBe("second entry");
  });

  it("keys memory by persona and treats '5' and '#5' as the same persona", () => {
    let log = appendMemory([], 5, "numeric id");
    log = appendMemory(log, "#5", "hash id");
    log = appendMemory(log, "#6", "other persona");
    const forFive = getMemory(log, "#5");
    expect(forFive.map((e) => e.text)).toEqual(["numeric id", "hash id"]);
    expect(getMemory(log, "5").length).toBe(2);
    expect(getMemory(log, "#6").map((e) => e.text)).toEqual(["other persona"]);
    expect(getMemory(log, "#7")).toEqual([]);
    // Sequence numbers are globally monotonic across personas.
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("rejects empty memory text", () => {
    expect(() => appendMemory([], "#1", "   ")).toThrow(/non-empty/);
  });

  it("reflects a remembered statement in the second interview — identically on repeat", () => {
    const population = fabricate({ count: 50, seed: "memory-seed" });
    const { model } = fitSurrogate(examples(), { seed: "memory-fit" });

    const first = lazyPersona(population, model, "#9", "support-tier");
    expect(first.memory).toEqual([]);
    expect(first.rationale).not.toContain("Previously stated");

    const log = appendMemory([], "#9", "Support told me the tier caps at 5 seats");
    const second = lazyPersona(population, model, "#9", "support-tier", log);
    expect(second.memory).toHaveLength(1);
    expect(second.memory[0].text).toBe(
      "Support told me the tier caps at 5 seats",
    );
    expect(second.rationale).toContain("Previously stated");
    expect(second.rationale).toContain("tier caps at 5 seats");

    // Repeated interview of the same persona+claim+memory: identical output.
    const repeat = lazyPersona(population, model, "#9", "support-tier", log);
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(second));
  });

  it("keeps memory persona-scoped inside the interview view", () => {
    const population = fabricate({ count: 50, seed: "memory-seed" });
    const { model } = fitSurrogate(examples(), { seed: "memory-fit" });
    const log = appendMemory(appendMemory([], "#4", "alpha"), "#5", "beta");
    expect(lazyPersona(population, model, "#4", "support-tier", log).memory).toHaveLength(1);
    expect(lazyPersona(population, model, "#5", "support-tier", log).memory).toHaveLength(1);
    expect(lazyPersona(population, model, "#6", "support-tier", log).memory).toHaveLength(0);
    // The quoted prior statement is the persona's OWN last entry.
    const view = lazyPersona(population, model, "#4", "support-tier", log);
    expect(view.rationale).toContain('"alpha"');
    expect(view.rationale).not.toContain('"beta"');
  });
});
