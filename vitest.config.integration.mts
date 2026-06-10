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

// Integration tests must run on the DIRECT (unpooled) endpoint. The pooled
// endpoint multiplexes statements across backend sessions, so session-scoped
// state — most importantly the pg_try_advisory_lock/pg_advisory_unlock pair
// in syncInvoices — can land on different backends. When that happens the
// unlock silently fails, the lock leaks on a pooler backend, and every later
// sync returns "Another sync is already in progress" (flaky test failures
// that persist across runs). Drizzle migrations already use the unpooled URL
// for the same reason.
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

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
