import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/oauth/store", () => ({
  getClientByPublicId: vi.fn(),
}));

import {
  buildRedirect,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorize";
import { getClientByPublicId } from "@/lib/oauth/store";
import { pkceChallengeFromVerifier } from "@/lib/oauth/validate";

const CLIENT = {
  id: 1,
  clientId: "mcp_client_abc",
  clientName: "Claude",
  redirectUris: [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost/callback",
  ],
  createdAt: new Date(),
  lastUsedAt: null,
};

const CHALLENGE = pkceChallengeFromVerifier(
  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
);

function validParams() {
  return {
    client_id: "mcp_client_abc",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientByPublicId).mockResolvedValue(CLIENT);
});

describe("validateAuthorizeRequest", () => {
  it("accepts a valid request and grants mcp:read", async () => {
    const result = await validateAuthorizeRequest(validParams());
    expect(result).toMatchObject({
      ok: true,
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      grantedScope: "mcp:read",
      state: "xyz",
    });
  });

  it("accepts a loopback redirect on any port", async () => {
    const result = await validateAuthorizeRequest({
      ...validParams(),
      redirect_uri: "http://localhost:53682/callback",
    });
    expect(result.ok).toBe(true);
  });

  it("is fatal (no redirect) for unknown client or unregistered redirect_uri", async () => {
    vi.mocked(getClientByPublicId).mockResolvedValue(undefined);
    const unknownClient = await validateAuthorizeRequest(validParams());
    expect(unknownClient).toMatchObject({ ok: false, fatal: true });

    vi.mocked(getClientByPublicId).mockResolvedValue(CLIENT);
    const badRedirect = await validateAuthorizeRequest({
      ...validParams(),
      redirect_uri: "https://evil.example.com/cb",
    });
    expect(badRedirect).toMatchObject({ ok: false, fatal: true });
  });

  it("is fatal when client_id or redirect_uri is missing", async () => {
    expect(
      await validateAuthorizeRequest({ ...validParams(), client_id: undefined }),
    ).toMatchObject({ ok: false, fatal: true });
    expect(
      await validateAuthorizeRequest({ ...validParams(), redirect_uri: undefined }),
    ).toMatchObject({ ok: false, fatal: true });
  });

  it.each([
    [
      "unsupported response_type",
      { response_type: "token" },
      "unsupported_response_type",
    ],
    ["missing code_challenge", { code_challenge: undefined }, "invalid_request"],
    [
      "non-S256 challenge method",
      { code_challenge_method: "plain" },
      "invalid_request",
    ],
    ["unknown scope", { scope: "admin:write" }, "invalid_scope"],
  ])("redirects with an error for %s", async (_label, overrides, expectedError) => {
    const result = await validateAuthorizeRequest({
      ...validParams(),
      ...overrides,
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.fatal) throw new Error("expected redirect error");
    const url = new URL(result.redirectTo);
    expect(url.origin + url.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(url.searchParams.get("error")).toBe(expectedError);
    expect(url.searchParams.get("state")).toBe("xyz");
  });
});

describe("buildRedirect", () => {
  it("appends params while preserving the URI's own query", () => {
    const result = buildRedirect("http://localhost/cb?keep=1", {
      code: "abc",
      state: "xyz",
      skipped: null,
    });
    const url = new URL(result);
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.has("skipped")).toBe(false);
  });
});
