import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the auth module to prevent next-auth import chain issues
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

import { requireBearerSecret } from "@/lib/auth-helpers";

const TEST_SECRET = "test-profile-secret-12345";

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  return new NextRequest("http://localhost:3000/api/profile?email=test@example.com", {
    headers,
  });
}

describe("Profile API authentication (requireBearerSecret)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests with no Authorization header", () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest();
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects requests with incorrect Bearer token", () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest("Bearer wrong-token");
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects requests with empty Bearer token", () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest("Bearer ");
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects requests with non-Bearer auth scheme", () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest(`Basic ${TEST_SECRET}`);
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("allows requests with correct Bearer token", () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest(`Bearer ${TEST_SECRET}`);
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).toBeNull();
  });

  it("rejects all requests when env var is not set (fail-closed)", () => {
    vi.stubEnv("PROFILE_API_SECRET", "");
    const request = makeRequest(`Bearer ${TEST_SECRET}`);
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns consistent error response format", async () => {
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    const request = makeRequest();
    const result = requireBearerSecret(request, "PROFILE_API_SECRET");
    expect(result).not.toBeNull();
    const body = await result!.json();
    expect(body).toEqual({ success: false, error: "Unauthorized" });
  });
});
