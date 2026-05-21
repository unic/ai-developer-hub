import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load .env.local for integration tests that hit the real Neon branch.
// (Unit tests don't need DB env; their config doesn't do this.)
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
