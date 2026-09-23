import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Runtime dependencies stay external; workspace packages (@murmur/*) are bundled in.
  external: ["@modelcontextprotocol/sdk", "better-sqlite3", "zod"],
});
