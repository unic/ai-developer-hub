import { describe, it, expect, vi, afterEach } from "vitest";
import { validateEnv, env } from "@/lib/env";

// validateEnv() accepts an explicit input object so tests don't rely on
// vi.stubEnv propagating into process.env (which can be unreliable with Zod's
// safeParse in some Vitest configurations).

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@host/db",
  AUTH_SECRET: "secret-32-chars-min-aaaaaaaaaaaaa",
  API_KEY_ENCRYPTION_SECRET: "enc-secret",
  CLOUDFLARE_R2_ACCOUNT_ID: "r2-account",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "r2-key-id",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "r2-secret",
  CLOUDFLARE_R2_BUCKET_NAME: "my-bucket",
  ANTHROPIC_API_KEY: "sk-ant-test",
  CRON_SECRET: "cron-secret-1234567890",
  INVOICE_INGEST_SECRET: "ingest-secret-1234567890",
  RESEND_API_KEY: "re_test",
  FROM_EMAIL: "noreply@test.com",
  SYSTEM_ADMIN_USER_ID: "1",
};

describe("validateEnv", () => {
  it("passes with all required vars present", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV })).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("throws when AUTH_SECRET is missing", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, AUTH_SECRET: "" })).toThrow(/AUTH_SECRET/);
  });

  it("throws when AUTH_SECRET is shorter than 32 characters", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, AUTH_SECRET: "too-short" })).toThrow(/AUTH_SECRET/);
  });

  it("throws when ANTHROPIC_API_KEY is missing", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws when CRON_SECRET is missing", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, CRON_SECRET: "" })).toThrow(/CRON_SECRET/);
  });

  it("throws when CRON_SECRET is shorter than 16 characters", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, CRON_SECRET: "tooshort" })).toThrow(/CRON_SECRET/);
  });

  it("throws when INVOICE_INGEST_SECRET is shorter than 16 characters", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, INVOICE_INGEST_SECRET: "weak" })).toThrow(/INVOICE_INGEST_SECRET/);
  });

  it("throws when SYSTEM_ADMIN_USER_ID is missing", () => {
    const { SYSTEM_ADMIN_USER_ID: _omit, ...withoutAdmin } = REQUIRED_ENV;
    void _omit;
    expect(() => validateEnv(withoutAdmin)).toThrow(/SYSTEM_ADMIN_USER_ID/);
  });

  it("throws when SYSTEM_ADMIN_USER_ID is set but not a positive integer", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, SYSTEM_ADMIN_USER_ID: "abc" })).toThrow(/SYSTEM_ADMIN_USER_ID/);
  });

  it("passes when SYSTEM_ADMIN_USER_ID is a valid positive integer string", () => {
    expect(() => validateEnv({ ...REQUIRED_ENV, SYSTEM_ADMIN_USER_ID: "42" })).not.toThrow();
  });

  it("passes when optional vars are absent", () => {
    // REQUIRED_ENV contains no optional vars — validate with only required ones
    expect(() => validateEnv({ ...REQUIRED_ENV })).not.toThrow();
  });

  it("skips validation when SKIP_ENV_VALIDATION=1 in input", () => {
    // Deliberately omit all required vars — should not throw because of the flag
    expect(() => validateEnv({ SKIP_ENV_VALIDATION: "1" })).not.toThrow();
  });

  it("does not skip validation when only process.env has SKIP_ENV_VALIDATION", () => {
    // Setting SKIP on process.env must NOT bypass validation when the caller
    // passes an explicit input — tests stay in full control of the env they validate.
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    try {
      expect(() => validateEnv({ DATABASE_URL: "" } as Record<string, string>)).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("env proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads process.env values lazily at call time", () => {
    vi.stubEnv("AUTH_SECRET", "initial-secret");
    expect(env.AUTH_SECRET).toBe("initial-secret");

    // Mutate via stubEnv — proxy should reflect the new value immediately
    vi.stubEnv("AUTH_SECRET", "updated-secret");
    expect(env.AUTH_SECRET).toBe("updated-secret");
  });

  it("reflects optional vars when set", () => {
    vi.stubEnv("PROFILE_API_SECRET", "my-secret");
    expect(env.PROFILE_API_SECRET).toBe("my-secret");
  });

  it("returns undefined for env vars not set", () => {
    // Ensure the var is absent (vi.stubEnv with undefined is not supported;
    // use delete to simulate absence, but vi.stubEnv("X", "") gives empty string)
    // This test verifies the proxy passes through whatever process.env holds
    const original = process.env.PROFILE_API_SECRET;

    try {
      delete process.env.PROFILE_API_SECRET;
      expect(env.PROFILE_API_SECRET).toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.PROFILE_API_SECRET = original;
      } else {
        delete process.env.PROFILE_API_SECRET;
      }
    }
  });
});
