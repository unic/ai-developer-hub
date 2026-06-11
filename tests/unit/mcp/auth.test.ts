import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/oauth/store", () => ({
  verifyAccessToken: vi.fn(),
  ACCESS_TOKEN_PREFIX: "mcp_at_",
}));

import { safeEqual, verifyMcpToken } from "@/lib/mcp/auth";
import { verifyAccessToken } from "@/lib/oauth/store";

const SECRET = "super-secret-mcp-token-123456";

function req(): Request {
  return new Request("http://localhost:3000/api/mcp/mcp", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for differing strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for differing lengths without throwing", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("verifyMcpToken — shared secret", () => {
  it("rejects a non-OAuth token when MCP_SERVER_SECRET is not set", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", "");
    await expect(verifyMcpToken(req(), "anything")).resolves.toBeUndefined();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects when no bearer token is provided", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    await expect(verifyMcpToken(req(), undefined)).resolves.toBeUndefined();
  });

  it("rejects an incorrect token", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    await expect(verifyMcpToken(req(), "wrong-token")).resolves.toBeUndefined();
  });

  it("returns admin-equivalent AuthInfo with the read scope for the correct token", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    const info = await verifyMcpToken(req(), SECRET);
    expect(info).toEqual({
      token: SECRET,
      clientId: "mcp-shared-secret",
      scopes: ["mcp:read"],
      // Org-level secret is explicitly admin-equivalent (039) — no bound user.
      extra: { role: "admin" },
    });
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});

describe("verifyMcpToken — OAuth access tokens", () => {
  it("resolves an mcp_at_ token via the OAuth store even without a shared secret", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", "");
    vi.mocked(verifyAccessToken).mockResolvedValue({
      userId: 42,
      email: "jane@example.com",
      name: "Jane",
      role: "viewer",
      clientPublicId: "mcp_client_abc",
      scope: "mcp:read",
    });

    const info = await verifyMcpToken(req(), "mcp_at_sometoken");
    expect(info).toEqual({
      token: "mcp_at_sometoken",
      clientId: "mcp_client_abc",
      scopes: ["mcp:read"],
      extra: {
        userId: 42,
        email: "jane@example.com",
        name: "Jane",
        role: "viewer",
      },
    });
    expect(verifyAccessToken).toHaveBeenCalledWith("mcp_at_sometoken");
  });

  it("rejects an unknown/revoked/expired OAuth token", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    vi.mocked(verifyAccessToken).mockResolvedValue(null);
    await expect(
      verifyMcpToken(req(), "mcp_at_revoked"),
    ).resolves.toBeUndefined();
  });

  it("does not hit the OAuth store for tokens without the mcp_at_ prefix", async () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    await expect(verifyMcpToken(req(), "random-token")).resolves.toBeUndefined();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
