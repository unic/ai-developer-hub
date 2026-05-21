import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// ESM-safe — __dirname is not defined in .mts modules.
const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local for integration tests that hit the real Neon branch.
// (Unit tests don't need DB env; their config doesn't do this.)
loadEnv({ path: path.join(here, ".env.local"), quiet: true });

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(here, "tests/shims/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
