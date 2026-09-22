/** Cleanroom gate as a vitest test (included in test:all). */
import { describe, expect, it } from "vitest";
import { runGate } from "./gate.mjs";

describe("cleanroom release gate", () => {
  it(
    "no egress, no keys, clean deps, fast first world, workspace isolation",
    async () => {
      const report = await runGate();
      for (const c of report.checks) {
        expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
      }
      expect(report.pass).toBe(true);
    },
    180_000
  );
});
