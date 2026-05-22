import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: mockFindFirst },
    },
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  isAgentDenied,
  getSessionCookieName,
  mintAgentJwt,
  BUILT_IN_DENY_PATHS,
} from "@/lib/agent-auth";
import { POST } from "@/app/api/agent/session/route";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = "test-agent-secret-xyz";
const TEST_AUTH_SECRET = "test-auth-secret-32bytes-min-len";
const AGENT_EMAIL = "nighthawk@agent.local";

function makeMintRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/agent/session", {
    method: "POST",
    headers,
  });
}

const mockAgentRow = {
  id: 42,
  name: "Nighthawk Agent",
  email: AGENT_EMAIL,
  role: "admin",
  discipline: "developer",
  status: "active",
  isAgent: true,
  preferences: { theme: "system" } as { theme: "system" | "light" | "dark" },
  passwordHash: "unused",
};

// ─────────────────────────────────────────────────────────────────────────────

describe("isAgentDenied", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies built-in destructive admin operations", () => {
    expect(isAgentDenied("/api/users", "DELETE")).toBe(true);
    expect(isAgentDenied("/api/users/42", "DELETE")).toBe(true);
  });

  it("denies built-in outbound-email POSTs", () => {
    expect(isAgentDenied("/api/users/invite", "POST")).toBe(true);
    expect(isAgentDenied("/api/users/reset-password", "POST")).toBe(true);
  });

  it("denies cron-only paths regardless of method", () => {
    expect(isAgentDenied("/api/sync/anthropic-usage", "GET")).toBe(true);
    expect(isAgentDenied("/api/sync", "POST")).toBe(true);
  });

  it("allows admin GETs that are not on the deny-list", () => {
    expect(isAgentDenied("/users", "GET")).toBe(false);
    expect(isAgentDenied("/dashboard", "GET")).toBe(false);
    expect(isAgentDenied("/api/users", "GET")).toBe(false);
  });

  it("does not match on shared prefix without boundary (no false positives)", () => {
    // /api/users-export should NOT match the /api/users entry
    expect(isAgentDenied("/api/users-export", "DELETE")).toBe(false);
  });

  it("respects AGENT_DENY_PATHS env extras", () => {
    vi.stubEnv("AGENT_DENY_PATHS", "/api/extra,POST /api/another");
    expect(isAgentDenied("/api/extra", "GET")).toBe(true);
    expect(isAgentDenied("/api/extra/nested", "POST")).toBe(true);
    expect(isAgentDenied("/api/another", "POST")).toBe(true);
    expect(isAgentDenied("/api/another", "GET")).toBe(false);
  });

  it("BUILT_IN_DENY_PATHS includes the documented entries", () => {
    expect(BUILT_IN_DENY_PATHS).toContain("DELETE /api/users");
    expect(BUILT_IN_DENY_PATHS).toContain("POST /api/users/invite");
    expect(BUILT_IN_DENY_PATHS).toContain("/api/sync");
  });
});

describe("getSessionCookieName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns __Secure- prefix for HTTPS URLs", () => {
    vi.stubEnv("AUTH_URL", "https://preview.vercel.app");
    expect(getSessionCookieName()).toBe("__Secure-authjs.session-token");
  });

  it("returns unprefixed name for HTTP URLs", () => {
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(getSessionCookieName()).toBe("authjs.session-token");
  });

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "https://prod.example.com");
    expect(getSessionCookieName()).toBe("__Secure-authjs.session-token");
  });
});

describe("mintAgentJwt", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
    vi.stubEnv("AUTH_URL", "https://preview.vercel.app");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints a token decodable with the same secret + salt", async () => {
    const { cookieName, token, maxAgeSeconds } = await mintAgentJwt(
      {
        id: "42",
        email: AGENT_EMAIL,
        name: "Nighthawk Agent",
        role: "admin",
        preferences: { theme: "system" },
        isAgent: true,
      },
      { maxAgeSeconds: 60 }
    );

    expect(cookieName).toBe("__Secure-authjs.session-token");
    expect(maxAgeSeconds).toBe(60);
    expect(typeof token).toBe("string");

    const decoded = await decode({
      token,
      secret: TEST_AUTH_SECRET,
      salt: cookieName,
    });
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("42");
    expect(decoded!.role).toBe("admin");
    expect(decoded!.isAgent).toBe(true);
  });

  it("throws when AUTH_SECRET is not set", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    await expect(
      mintAgentJwt({
        id: "1",
        email: "x@y",
        name: "x",
        role: "admin",
        preferences: { theme: "system" },
        isAgent: true,
      })
    ).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("POST /api/agent/session", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", TEST_AUTH_SECRET);
    vi.stubEnv("AGENT_SESSION_SECRET", TEST_SECRET);
    vi.stubEnv("AGENT_USER_EMAIL", AGENT_EMAIL);
    vi.stubEnv("AUTH_URL", "https://preview.vercel.app");
    vi.stubEnv("VERCEL_ENV", "preview");
    mockFindFirst.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await POST(makeMintRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with the wrong bearer", async () => {
    const res = await POST(makeMintRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 403 on production regardless of bearer", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mockFindFirst.mockResolvedValue(mockAgentRow);
    const res = await POST(makeMintRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/production/i);
  });

  it("returns 503 when no agent user is provisioned", async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const res = await POST(makeMintRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not provisioned/i);
  });

  it("returns 503 when the agent user is inactive", async () => {
    mockFindFirst.mockResolvedValue({ ...mockAgentRow, status: "inactive" });
    const res = await POST(makeMintRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(503);
  });

  it("returns 200 + Set-Cookie + decodable token on preview with valid bearer", async () => {
    mockFindFirst.mockResolvedValue(mockAgentRow);

    const res = await POST(makeMintRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.cookieName).toBe("__Secure-authjs.session-token");
    expect(body.expiresIn).toBe(30 * 60);
    expect(body.token).toBeUndefined();

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie!.toLowerCase()).toContain("httponly");
    expect(setCookie!.toLowerCase()).toContain("samesite=lax");

    const tokenMatch = setCookie!.match(
      new RegExp(`${body.cookieName}=([^;]+)`)
    );
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]);

    const decoded = await decode({
      token,
      secret: TEST_AUTH_SECRET,
      salt: body.cookieName,
    });
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(String(mockAgentRow.id));
    expect(decoded!.role).toBe("admin");
    expect(decoded!.isAgent).toBe(true);
    expect(decoded!.email).toBe(AGENT_EMAIL);

    const now = Math.floor(Date.now() / 1000);
    const exp = decoded!.exp as number;
    expect(exp).toBeGreaterThan(now + 29 * 60);
    expect(exp).toBeLessThan(now + 31 * 60);
  });
});
