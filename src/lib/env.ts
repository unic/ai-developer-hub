import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().optional(),

  // Auth (NextAuth v5) — min 32 chars matches `openssl rand -base64 32` output
  // and Auth.js's recommended minimum entropy for HMAC-derived session keys.
  AUTH_SECRET: z
    .string()
    .min(
      32,
      "AUTH_SECRET must be at least 32 characters (generate with `openssl rand -base64 32`)",
    ),
  AUTH_URL: z.string().optional(),
  NEXTAUTH_URL: z.string().optional(),

  // Vercel runtime-injected (not set locally; optional)
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),

  // API key encryption
  API_KEY_ENCRYPTION_SECRET: z
    .string()
    .min(1, "API_KEY_ENCRYPTION_SECRET is required"),

  // Cloudflare R2 (invoice PDF storage)
  CLOUDFLARE_R2_ACCOUNT_ID: z
    .string()
    .min(1, "CLOUDFLARE_R2_ACCOUNT_ID is required"),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z
    .string()
    .min(1, "CLOUDFLARE_R2_ACCESS_KEY_ID is required"),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z
    .string()
    .min(1, "CLOUDFLARE_R2_SECRET_ACCESS_KEY is required"),
  CLOUDFLARE_R2_BUCKET_NAME: z
    .string()
    .min(1, "CLOUDFLARE_R2_BUCKET_NAME is required"),

  // Anthropic (invoice extraction)
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  // Anthropic Admin API key (workspace sync) — optional; sync skips when absent
  ANTHROPIC_ADMIN_API_KEY: z.string().optional(),
  ANTHROPIC_API_VERSION: z.string().optional(),

  // Cron and bearer authentication secrets — min 16 chars rejects accidental
  // weak values (e.g. "test", "changeme") at startup.
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),
  INVOICE_INGEST_SECRET: z
    .string()
    .min(16, "INVOICE_INGEST_SECRET must be at least 16 characters"),
  // Agent session secret — only required on non-production preview/local
  AGENT_SESSION_SECRET: z.string().optional(),

  // Transactional email
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  FROM_EMAIL: z.string().min(1, "FROM_EMAIL is required"),

  // Admin user for automated/API-initiated operations.
  // Required at startup so /api/invoices/ingest doesn't hard-fail in production.
  // Must reference an active admin user; the actual DB lookup is performed at
  // runtime by getSystemAdminUserId() since the schema can't reach the DB.
  SYSTEM_ADMIN_USER_ID: z
    .string()
    .regex(/^[1-9]\d*$/, "SYSTEM_ADMIN_USER_ID must be a positive integer"),

  // Nighthawk agent
  AGENT_USER_EMAIL: z.string().optional(),
  AGENT_DENY_PATHS: z.string().optional(),

  // Profile API preview
  PROFILE_API_SECRET: z.string().optional(),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),

  // MCP server shared-secret bearer token. Optional so existing deployments
  // boot without it; when unset the MCP server is dormant and rejects all
  // requests. min 16 chars rejects accidental weak values, matching CRON_SECRET.
  MCP_SERVER_SECRET: z
    .string()
    .min(16, "MCP_SERVER_SECRET must be at least 16 characters")
    .optional(),

  // MCP write tools (043-mcp-write-tools). Declared here for discoverability and
  // boot-time validation only — the write gate reads process.env.MCP_WRITE_ENABLED
  // directly on every request (src/lib/mcp/access.ts) rather than through this
  // memoized object, so the value can change without a process restart.
  //
  // Literal "1" enables; anything else (including "true") leaves writes disabled.
  // The regex makes a well-meant "true" fail loudly at boot instead of silently
  // behaving as off.
  MCP_WRITE_ENABLED: z
    .string()
    .regex(/^[01]$/, 'MCP_WRITE_ENABLED must be "1" (enabled) or "0"/unset (disabled)')
    .optional(),

  // Comma-separated email domains create_user will accept, e.g. "unic.com,example.org".
  // Defaults to unic.com when unset (see allowedEmailDomains in src/lib/mcp/write.ts).
  // Stops an agent following instructions embedded in a ticket or mail thread from
  // creating an account on an address outside the org.
  MCP_WRITE_EMAIL_DOMAINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables against the schema.
 * Call this at boot time (via src/instrumentation.ts) to fail fast on
 * misconfiguration. Set SKIP_ENV_VALIDATION=1 to bypass in CI builds where
 * not all runtime vars are available at build time.
 *
 * @param input Defaults to process.env. Pass a custom object in unit tests.
 */
export function validateEnv(
  input: Record<string, string | undefined> = process.env,
): void {
  // Read SKIP from the explicit input only — never fall back to process.env so
  // tests passing a custom env object are fully in control of validation.
  if (input.SKIP_ENV_VALIDATION === "1") return;
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${String(i.path[0])}: ${i.message}`)
      .join("\n");
    throw new Error(`\nInvalid environment variables:\n${issues}\n`);
  }
}

/**
 * Typed proxy over process.env. Each property access reads the current value
 * from process.env at call time, so vi.stubEnv() continues to work in tests
 * without requiring vi.resetModules(). Call validateEnv() at boot to guarantee
 * required vars are present in production.
 */
export const env = new Proxy({} as Env, {
  get(_target, prop: string | symbol): string | undefined {
    return (process.env as Record<string, string | undefined>)[prop as string];
  },
});
