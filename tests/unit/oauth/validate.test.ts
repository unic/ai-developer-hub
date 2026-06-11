import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  clientRegistrationSchema,
  isAllowedRedirectUri,
  pkceChallengeFromVerifier,
  redirectUriMatches,
  validateRequestedScope,
  verifyPkce,
  MCP_SCOPE,
} from "@/lib/oauth/validate";

describe("isAllowedRedirectUri", () => {
  it("allows https URIs", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("allows http only on loopback hosts", () => {
    expect(isAllowedRedirectUri("http://localhost:53682/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8080/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://192.168.1.10/callback")).toBe(false);
  });

  it("rejects fragments, credentials, custom schemes, and garbage", () => {
    expect(isAllowedRedirectUri("https://a.com/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pw@a.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("myapp://callback")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("not a uri")).toBe(false);
  });
});

describe("redirectUriMatches", () => {
  it("matches exact strings", () => {
    expect(
      redirectUriMatches(
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/api/mcp/auth_callback",
      ),
    ).toBe(true);
  });

  it("rejects any https mismatch (no port relaxation)", () => {
    expect(
      redirectUriMatches("https://a.com/cb", "https://a.com:8443/cb"),
    ).toBe(false);
    expect(redirectUriMatches("https://a.com/cb", "https://a.com/cb2")).toBe(false);
  });

  it("ignores the port for http loopback URIs (RFC 8252 §7.3)", () => {
    expect(
      redirectUriMatches("http://localhost/callback", "http://localhost:53682/callback"),
    ).toBe(true);
    expect(
      redirectUriMatches("http://127.0.0.1:1234/callback", "http://127.0.0.1:9999/callback"),
    ).toBe(true);
  });

  it("does not relax host, path, or query for loopback URIs", () => {
    expect(
      redirectUriMatches("http://localhost/callback", "http://127.0.0.1/callback"),
    ).toBe(false);
    expect(
      redirectUriMatches("http://localhost/callback", "http://localhost/other"),
    ).toBe(false);
    expect(
      redirectUriMatches("http://localhost/cb?a=1", "http://localhost/cb?a=2"),
    ).toBe(false);
  });
});

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("computes the S256 challenge as base64url(sha256(verifier))", () => {
    const expected = createHash("sha256").update(verifier, "ascii").digest("base64url");
    expect(pkceChallengeFromVerifier(verifier)).toBe(expected);
  });

  it("verifies a correct verifier and rejects a wrong one", () => {
    const challenge = pkceChallengeFromVerifier(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier.slice(0, -1)}x`, challenge)).toBe(false);
  });

  it("rejects verifiers outside the RFC 7636 alphabet/length", () => {
    expect(verifyPkce("too-short", pkceChallengeFromVerifier("too-short"))).toBe(false);
    const invalid = "!".repeat(50);
    expect(verifyPkce(invalid, pkceChallengeFromVerifier(invalid))).toBe(false);
  });
});

describe("validateRequestedScope", () => {
  it("defaults to mcp:read when absent", () => {
    expect(validateRequestedScope(undefined)).toEqual({ ok: true, granted: MCP_SCOPE });
    expect(validateRequestedScope("")).toEqual({ ok: true, granted: MCP_SCOPE });
  });

  it("accepts mcp:read and tolerates offline_access", () => {
    expect(validateRequestedScope("mcp:read")).toEqual({ ok: true, granted: MCP_SCOPE });
    expect(validateRequestedScope("mcp:read offline_access").ok).toBe(true);
  });

  it("rejects unknown scopes", () => {
    expect(validateRequestedScope("admin:write").ok).toBe(false);
  });
});

describe("clientRegistrationSchema", () => {
  it("accepts minimal valid metadata", () => {
    const result = clientRegistrationSchema.safeParse({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one redirect URI", () => {
    expect(
      clientRegistrationSchema.safeParse({ redirect_uris: [] }).success,
    ).toBe(false);
    expect(clientRegistrationSchema.safeParse({}).success).toBe(false);
  });
});
