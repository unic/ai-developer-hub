import { describe, it, expect } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import {
  ADMIN_REQUIRED_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  SELF_ONLY_MESSAGE,
  adminOnly,
  callerFromAuthInfo,
  resolveSelfEmail,
  type McpCaller,
} from "@/lib/mcp/access";

function authInfo(extra?: Record<string, unknown>): AuthInfo {
  return { token: "t", clientId: "c", scopes: ["mcp:read"], extra };
}

describe("callerFromAuthInfo", () => {
  it("parses an admin OAuth token", () => {
    const caller = callerFromAuthInfo(
      authInfo({ userId: 7, email: "a@unic.com", name: "A", role: "admin" }),
    );
    expect(caller).toEqual({ role: "admin", userId: 7, email: "a@unic.com" });
  });

  it("parses a viewer OAuth token", () => {
    const caller = callerFromAuthInfo(
      authInfo({ userId: 9, email: "v@unic.com", name: "V", role: "viewer" }),
    );
    expect(caller.role).toBe("viewer");
  });

  it("treats the shared-secret extra as admin without identity", () => {
    const caller = callerFromAuthInfo(authInfo({ role: "admin" }));
    expect(caller).toEqual({ role: "admin", userId: undefined, email: undefined });
  });

  it.each([
    ["missing authInfo", undefined],
    ["missing extra", authInfo(undefined)],
    ["missing role", authInfo({ userId: 1, email: "x@unic.com" })],
    ["unknown role value", authInfo({ role: "superadmin" })],
    ["non-string role", authInfo({ role: 1 })],
  ])("defaults to viewer (least privilege) for %s", (_label, info) => {
    expect(callerFromAuthInfo(info as AuthInfo | undefined).role).toBe("viewer");
  });

  it("ignores malformed identity fields", () => {
    const caller = callerFromAuthInfo(
      authInfo({ role: "admin", userId: "7", email: 42 }),
    );
    expect(caller.userId).toBeUndefined();
    expect(caller.email).toBeUndefined();
  });
});

describe("resolveSelfEmail", () => {
  const admin: McpCaller = { role: "admin", userId: 1, email: "Admin@unic.com" };
  const viewer: McpCaller = { role: "viewer", userId: 2, email: "Viewer@unic.com" };
  const secret: McpCaller = { role: "admin" };

  it("admin: requested email wins", () => {
    expect(resolveSelfEmail(admin, "other@unic.com")).toEqual({
      ok: true,
      email: "other@unic.com",
    });
  });

  it("admin: omitted email defaults to own", () => {
    expect(resolveSelfEmail(admin)).toEqual({ ok: true, email: "Admin@unic.com" });
  });

  it("shared secret (admin, no identity): omitted email is a validation error", () => {
    expect(resolveSelfEmail(secret)).toEqual({
      ok: false,
      message: EMAIL_REQUIRED_MESSAGE,
    });
  });

  it("shared secret: explicit email passes through", () => {
    expect(resolveSelfEmail(secret, "x@unic.com")).toEqual({
      ok: true,
      email: "x@unic.com",
    });
  });

  it("viewer: omitted email resolves to own", () => {
    expect(resolveSelfEmail(viewer)).toEqual({ ok: true, email: "Viewer@unic.com" });
  });

  it("viewer: own email accepted case-insensitively and trimmed", () => {
    expect(resolveSelfEmail(viewer, "  vIeWeR@UNIC.COM  ")).toEqual({
      ok: true,
      email: "Viewer@unic.com",
    });
  });

  it("viewer: a foreign email is refused, never substituted", () => {
    expect(resolveSelfEmail(viewer, "admin@unic.com")).toEqual({
      ok: false,
      message: SELF_ONLY_MESSAGE,
    });
  });

  it("viewer without bound identity is refused (fail-closed)", () => {
    expect(resolveSelfEmail({ role: "viewer" })).toEqual({
      ok: false,
      message: SELF_ONLY_MESSAGE,
    });
  });
});

describe("adminOnly", () => {
  const run = async () => ({ data: 1 });

  it("denies a viewer with the shared message and never runs the data fn", async () => {
    let called = false;
    const handler = adminOnly(async () => {
      called = true;
      return {};
    });
    const result = await handler({}, { authInfo: authInfo({ role: "viewer" }) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${ADMIN_REQUIRED_MESSAGE}`);
    expect(called).toBe(false);
  });

  it("denies when authInfo is absent entirely (fail-closed)", async () => {
    const result = await adminOnly(run)({}, {});
    expect(result.isError).toBe(true);
  });

  it("runs the data fn for an admin token", async () => {
    const result = await adminOnly(run)(
      {},
      { authInfo: authInfo({ role: "admin", userId: 1, email: "a@unic.com" }) },
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ data: 1 });
  });

  it("runs the data fn for the shared secret", async () => {
    const result = await adminOnly(run)({}, { authInfo: authInfo({ role: "admin" }) });
    expect(result.isError).toBeUndefined();
  });

  it("enforcement is per-call: a role flip between calls flips access (live role)", async () => {
    const handler = adminOnly(run);
    const asAdmin = await handler(
      {},
      { authInfo: authInfo({ userId: 5, email: "u@unic.com", role: "admin" }) },
    );
    // Same user, same handler — the next request carries the demoted role.
    const asViewer = await handler(
      {},
      { authInfo: authInfo({ userId: 5, email: "u@unic.com", role: "viewer" }) },
    );
    expect(asAdmin.isError).toBeUndefined();
    expect(asViewer.isError).toBe(true);
  });

  it("still degrades data-fn errors to isError results for admins", async () => {
    const handler = adminOnly(async () => {
      throw new Error("db down");
    });
    const result = await handler({}, { authInfo: authInfo({ role: "admin" }) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: db down");
  });
});
