import { describe, it, expect } from "vitest";

import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  requestOrigin,
} from "@/lib/oauth/metadata";

describe("requestOrigin", () => {
  it("uses the request URL for plain local requests", () => {
    const req = new Request("http://localhost:3000/.well-known/oauth-authorization-server");
    expect(requestOrigin(req)).toBe("http://localhost:3000");
  });

  it("honours x-forwarded-host and x-forwarded-proto behind a proxy", () => {
    const req = new Request("http://10.0.0.1/.well-known/oauth-authorization-server", {
      headers: {
        "x-forwarded-host": "hub.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOrigin(req)).toBe("https://hub.example.com");
  });
});

describe("authorizationServerMetadata", () => {
  it("advertises the endpoints and S256-only PKCE", () => {
    const doc = authorizationServerMetadata("https://hub.example.com");
    expect(doc).toMatchObject({
      issuer: "https://hub.example.com",
      authorization_endpoint: "https://hub.example.com/oauth/authorize",
      token_endpoint: "https://hub.example.com/api/oauth/token",
      registration_endpoint: "https://hub.example.com/api/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
  });
});

describe("protectedResourceMetadata", () => {
  it("points at the MCP endpoint with the origin as authorization server", () => {
    const doc = protectedResourceMetadata("https://hub.example.com");
    expect(doc).toMatchObject({
      resource: "https://hub.example.com/api/mcp/mcp",
      authorization_servers: ["https://hub.example.com"],
      scopes_supported: ["mcp:read"],
    });
  });
});
