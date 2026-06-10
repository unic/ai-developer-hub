import { describe, it, expect, vi, afterEach } from "vitest";
import { safeEqual, verifyMcpToken } from "@/lib/mcp/auth";

const SECRET = "super-secret-mcp-token-123456";

function req(): Request {
  return new Request("http://localhost:3000/api/mcp/mcp", { method: "POST" });
}

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

describe("verifyMcpToken", () => {
  it("rejects when MCP_SERVER_SECRET is not set", () => {
    vi.stubEnv("MCP_SERVER_SECRET", "");
    expect(verifyMcpToken(req(), "anything")).toBeUndefined();
  });

  it("rejects when no bearer token is provided", () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    expect(verifyMcpToken(req(), undefined)).toBeUndefined();
  });

  it("rejects an incorrect token", () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    expect(verifyMcpToken(req(), "wrong-token")).toBeUndefined();
  });

  it("returns AuthInfo for the correct token", () => {
    vi.stubEnv("MCP_SERVER_SECRET", SECRET);
    const info = verifyMcpToken(req(), SECRET);
    expect(info).toEqual({
      token: SECRET,
      clientId: "mcp-shared-secret",
      scopes: [],
    });
  });
});
