// Next.js instrumentation hook — runs once at server startup (not during build or lint).
// Use this for startup-time side effects like env validation.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();
  }
}
