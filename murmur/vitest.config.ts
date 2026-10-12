import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  "@murmur/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)),
  "@murmur/prompts": fileURLToPath(new URL("./packages/prompts/src/index.ts", import.meta.url)),
  "@murmur/adapters": fileURLToPath(new URL("./packages/adapters/src/index.ts", import.meta.url)),
  "@murmur/templates": fileURLToPath(new URL("./packages/templates/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Coverage is measured across the unit + golden projects. It is declared at
    // the root so both projects contribute to the same merged report; the e2e
    // project is excluded because it spawns built artifacts in a subprocess,
    // which v8 coverage cannot attribute to the source map.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/dist/**",
        "**/*.test.ts",
        "packages/*/src/index.ts",
        "packages/server/src/server.ts",
        "packages/server/src/index.ts",
        "packages/server/src/logging.ts",
        "packages/server/src/prompts.ts",
        // NOTE: packages/server/src/tools/** is deliberately INCLUDED. It is
        // the least-tested code in the repo and excluding it would inflate the
        // headline number while hiding exactly the code the gate should watch.
      ],
      // Measured baseline is ~78% statements with the server tools included
      // (cli.ts, doctor.ts and the interact/session paths were at 0% before
      // server-cli.test.ts). The gate sits just below it so it ratchets:
      // any change that drops coverage fails, and raising the numbers is
      // always welcome. Do not raise these without the tests that earn it.
      thresholds: {
        statements: 75,
        branches: 80,
        functions: 75,
        lines: 75,
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "golden",
          include: ["tests/golden/**/*.test.ts"],
          environment: "node",
          testTimeout: 120_000,
        },
      },
      {
        // e2e spawns the BUILT server — run `npm run build` first (npm run test:e2e does)
        resolve: { alias },
        test: {
          name: "e2e",
          include: ["tests/integration/**/*.test.ts", "tests/cleanroom/**/*.test.ts"],
          environment: "node",
          testTimeout: 180_000,
        },
      },
    ],
  },
});
