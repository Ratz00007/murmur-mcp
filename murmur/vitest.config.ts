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
