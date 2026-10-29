import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  "@murmur/engine": fileURLToPath(new URL("../../../packages/engine/src/index.ts", import.meta.url)),
  "@murmur/prompts": fileURLToPath(new URL("../../../packages/prompts/src/index.ts", import.meta.url)),
  "@murmur/adapters": fileURLToPath(new URL("../../../packages/adapters/src/index.ts", import.meta.url)),
  "@murmur/templates": fileURLToPath(new URL("../../../packages/templates/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["tests/e2e/market-twin/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
