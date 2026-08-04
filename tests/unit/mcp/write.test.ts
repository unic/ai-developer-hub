import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpToolResult } from "@/lib/mcp/format";

vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-auth-secret-at-least-32-chars-long!!" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/invite", () => ({
  createInviteTokenForUser: vi.fn(async () => ({
    inviteUrl: "https://hub.example/setup-password?token=SECRET",
  })),
}));

/** isAgentUser() looks the actor up; default to a non-agent row. */
vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: vi.fn() } } },
}));

vi.mock("@/lib/core/users", () => ({
  createUserCore: vi.fn(),
  updateUserCore: vi.fn(),
  deactivateUserCore: vi.fn(),
}));
vi.mock("@/lib/core/assignments", () => ({
  assignLicenseCore: vi.fn(),
  revokeLicenseCore: vi.fn(),
  updateAssignmentCore: vi.fn(),
}));
// Keep the real cents guard and MAX_REPRICE_ROWS; stub only the write functions.
vi.mock("@/lib/core/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/tools")>();
  return {
    ...actual,
    createTierCore: vi.fn(),
    updateTierCore: vi.fn(),
    setTierPriceCore: vi.fn(),
  };
});

import { registerHubWriteTools, checkEmailDomain } from "@/lib/mcp/write";
import type { ToolRegistrar } from "@/lib/mcp/tools";
import {
  ADMIN_REQUIRED_MESSAGE,
  WRITE_DISABLED_MESSAGE,
  WRITE_SCOPE_REQUIRED_MESSAGE,
  WRITE_NEEDS_BOUND_USER_MESSAGE,
  AGENT_ACTOR_REFUSED_MESSAGE,
} from "@/lib/mcp/access";
import { MCP_NO_SECRETS_MESSAGE } from "@/lib/core/context";
import { MCP_SCOPE, MCP_WRITE_SCOPE } from "@/lib/oauth/validate";
import { db } from "@/lib/db";
import * as usersCore from "@/lib/core/users";
import * as assignmentsCore from "@/lib/core/assignments";
import * as toolsCore from "@/lib/core/tools";

const findFirstUser = vi.mocked(db.query.users.findFirst);

type Handler = (
  args: Record<string, unknown>,
  extra?: { authInfo?: AuthInfo },
) => Promise<McpToolResult>;
type ToolMeta = {
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
};

function collectTools(): Map<string, { meta: ToolMeta; handler: Handler }> {
  const tools = new Map<string, { meta: ToolMeta; handler: Handler }>();
  const fakeServer = {
    registerTool: (name: string, meta: ToolMeta, handler: Handler) => {
      tools.set(name, { meta, handler });
      return undefined;
    },
  };
  registerHubWriteTools(fakeServer as unknown as ToolRegistrar);
  return tools;
}

function authInfo(
  extra?: Record<string, unknown>,
  scopes: string[] = [MCP_SCOPE, MCP_WRITE_SCOPE],
): { authInfo: AuthInfo } {
  return { authInfo: { token: "t", clientId: "client-1", scopes, extra } };
}

/** An OAuth-bound admin holding mcp:write — the only credential that may write. */
const WRITER = authInfo({
  userId: 1,
  email: "admin@unic.com",
  name: "Admin",
  role: "admin",
});
const VIEWER = authInfo({ userId: 2, email: "viewer@unic.com", role: "viewer" });
const ADMIN_NO_WRITE_SCOPE = authInfo(
  { userId: 1, email: "admin@unic.com", role: "admin" },
  [MCP_SCOPE],
);
/** Shared secret: admin-equivalent but unbound, and its scopes are read-only. */
const SECRET = authInfo({ role: "admin" }, [MCP_SCOPE]);
/** Hypothetical unbound credential that somehow carries the write scope. */
const UNBOUND_WITH_SCOPE = authInfo({ role: "admin" });

/** Every write tool and the core it must never reach when the gate refuses. */
const WRITE_TOOLS: Record<string, { core: () => unknown; args: object }> = {
  create_user: {
    core: () => usersCore.createUserCore,
    args: {
      name: "A",
      email: "a@unic.com",
      discipline: "developer",
    },
  },
  update_user: {
    core: () => usersCore.updateUserCore,
    args: { userId: 5, expectedEmail: "a@unic.com", name: "B" },
  },
  deactivate_user: {
    core: () => usersCore.deactivateUserCore,
    args: { userId: 5, expectedEmail: "a@unic.com" },
  },
  assign_license: {
    core: () => assignmentsCore.assignLicenseCore,
    args: {
      userId: 5,
      expectedUserEmail: "a@unic.com",
      toolId: 1,
      tierId: 2,
    },
  },
  update_assignment: {
    core: () => assignmentsCore.updateAssignmentCore,
    args: { assignmentId: 9, expectedUserEmail: "a@unic.com", tierId: 3 },
  },
  revoke_license: {
    core: () => assignmentsCore.revokeLicenseCore,
    args: { assignmentId: 9, expectedUserEmail: "a@unic.com" },
  },
  create_access_tier: {
    core: () => toolsCore.createTierCore,
    args: {
      toolId: 1,
      expectedToolName: "Acme",
      name: "Pro",
      monthlyCostCents: 1900,
    },
  },
  update_access_tier: {
    core: () => toolsCore.updateTierCore,
    args: {
      tierId: 2,
      expectedToolName: "Acme",
      expectedTierName: "Pro",
      name: "Pro Plus",
    },
  },
  set_tier_price: {
    core: () => toolsCore.setTierPriceCore,
    args: {
      tierId: 2,
      expectedToolName: "Acme",
      expectedTierName: "Pro",
      expectedMonthlyCostCents: 1900,
      monthlyCostCents: 2900,
    },
  },
};

const TOOL_NAMES = Object.keys(WRITE_TOOLS);

beforeEach(() => {
  vi.clearAllMocks();
  findFirstUser.mockResolvedValue({ isAgent: false } as never);
  process.env.MCP_WRITE_ENABLED = "1";
  process.env.MCP_WRITE_EMAIL_DOMAINS = "unic.com";
});

afterEach(() => {
  delete process.env.MCP_WRITE_ENABLED;
  delete process.env.MCP_WRITE_EMAIL_DOMAINS;
});

describe("registerHubWriteTools", () => {
  it("registers exactly the expected write tools", () => {
    expect([...collectTools().keys()].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("marks every write tool readOnlyHint:false — the read/write sets cannot blur", () => {
    for (const [name, { meta }] of collectTools()) {
      expect(meta.annotations?.readOnlyHint, `${name} must not claim read-only`).toBe(
        false,
      );
    }
  });

  it("marks the value-destroying tools destructiveHint:true", () => {
    // This flag is what makes an auto-approving client stop and ask a human, so
    // it is load-bearing for set_tier_price even though no row is deleted.
    const tools = collectTools();
    for (const name of ["deactivate_user", "revoke_license", "set_tier_price"]) {
      expect(tools.get(name)!.meta.annotations?.destructiveHint, name).toBe(true);
    }
    for (const name of ["create_user", "assign_license", "create_access_tier"]) {
      expect(tools.get(name)!.meta.annotations?.destructiveHint, name).toBe(false);
    }
  });

  it("documents the write requirement in every description", () => {
    for (const [name, { meta }] of collectTools()) {
      expect(meta.description, `${name} missing write hint`).toContain(
        "Requires an admin-role token with write access.",
      );
    }
  });
});

describe("write gate", () => {
  it.each(TOOL_NAMES)("%s refuses a viewer and never reaches the core", async (name) => {
    const handlers = collectTools();
    const result = await handlers.get(name)!.handler(
      WRITE_TOOLS[name].args as Record<string, unknown>,
      VIEWER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${ADMIN_REQUIRED_MESSAGE}`);
    expect(WRITE_TOOLS[name].core()).not.toHaveBeenCalled();
  });

  it.each(TOOL_NAMES)(
    "%s refuses an admin token without the mcp:write scope",
    async (name) => {
      const handlers = collectTools();
      const result = await handlers.get(name)!.handler(
        WRITE_TOOLS[name].args as Record<string, unknown>,
        ADMIN_NO_WRITE_SCOPE,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(`Error: ${WRITE_SCOPE_REQUIRED_MESSAGE}`);
      expect(WRITE_TOOLS[name].core()).not.toHaveBeenCalled();
    },
  );

  it.each(TOOL_NAMES)("%s refuses when the kill switch is off", async (name) => {
    delete process.env.MCP_WRITE_ENABLED;
    const handlers = collectTools();
    const result = await handlers.get(name)!.handler(
      WRITE_TOOLS[name].args as Record<string, unknown>,
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${WRITE_DISABLED_MESSAGE}`);
    expect(WRITE_TOOLS[name].core()).not.toHaveBeenCalled();
  });

  it.each(TOOL_NAMES)("%s refuses when authInfo is absent (fail-closed)", async (name) => {
    const handlers = collectTools();
    const result = await handlers
      .get(name)!
      .handler(WRITE_TOOLS[name].args as Record<string, unknown>);
    expect(result.isError).toBe(true);
    expect(WRITE_TOOLS[name].core()).not.toHaveBeenCalled();
  });

  it("refuses the shared MCP secret — an unbound credential cannot be audited", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("assign_license")!
      .handler(WRITE_TOOLS.assign_license.args as Record<string, unknown>, SECRET);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${WRITE_SCOPE_REQUIRED_MESSAGE}`);
    expect(assignmentsCore.assignLicenseCore).not.toHaveBeenCalled();
  });

  it("refuses an unbound credential even if it somehow carries mcp:write", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("assign_license")!
      .handler(
        WRITE_TOOLS.assign_license.args as Record<string, unknown>,
        UNBOUND_WITH_SCOPE,
      );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      `Error: ${WRITE_NEEDS_BOUND_USER_MESSAGE}`,
    );
  });

  it("refuses an automation (isAgent) actor", async () => {
    findFirstUser.mockResolvedValue({ isAgent: true } as never);
    const handlers = collectTools();
    const result = await handlers
      .get("assign_license")!
      .handler(WRITE_TOOLS.assign_license.args as Record<string, unknown>, WRITER);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${AGENT_ACTOR_REFUSED_MESSAGE}`);
    expect(assignmentsCore.assignLicenseCore).not.toHaveBeenCalled();
  });
});

describe("secret refusal", () => {
  it.each(["assign_license", "update_assignment"])(
    "%s refuses an apiKey without echoing the submitted value",
    async (name) => {
      const handlers = collectTools();
      const secret = "sk-ant-api03-SUPERSECRET";
      const result = await handlers.get(name)!.handler(
        { ...WRITE_TOOLS[name].args, apiKey: secret },
        WRITER,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(`Error: ${MCP_NO_SECRETS_MESSAGE}`);
      expect(result.content[0].text).not.toContain(secret);
      expect(WRITE_TOOLS[name].core()).not.toHaveBeenCalled();
    },
  );

  it("refuses a licenseCode too", async () => {
    const handlers = collectTools();
    const result = await handlers.get("assign_license")!.handler(
      { ...WRITE_TOOLS.assign_license.args, licenseCode: "LIC-123" },
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("LIC-123");
  });

  it("leads both descriptions with the never-send instruction", () => {
    const tools = collectTools();
    for (const name of ["assign_license", "update_assignment"]) {
      expect(tools.get(name)!.meta.description).toContain(
        "NEVER send an API key or license code",
      );
    }
  });
});

describe("create_user", () => {
  beforeEach(() => {
    vi.mocked(usersCore.createUserCore).mockResolvedValue({
      ok: true,
      data: { userId: 42, email: "new@unic.com", role: "viewer", inviteUrl: null },
      revalidate: ["/users"],
    });
  });

  it("forces the viewer role regardless of anything the caller asked for", async () => {
    const handlers = collectTools();
    await handlers.get("create_user")!.handler(
      {
        name: "New",
        email: "new@unic.com",
        discipline: "developer",
        role: "admin",
      },
      WRITER,
    );
    expect(usersCore.createUserCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "viewer" }),
      expect.any(Function),
    );
  });

  it("never returns a setup-password URL", async () => {
    const handlers = collectTools();
    const result = await handlers.get("create_user")!.handler(
      { name: "New", email: "new@unic.com", discipline: "developer" },
      WRITER,
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toContain("setup-password");
    expect(text).not.toContain("token=");
    expect(JSON.parse(text).canSignIn).toBe(false);
  });

  it("refuses an email outside the allow-listed org domain", async () => {
    const handlers = collectTools();
    const result = await handlers.get("create_user")!.handler(
      { name: "Bad", email: "attacker@gmail.com", discipline: "developer" },
      WRITER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("@unic.com");
    expect(usersCore.createUserCore).not.toHaveBeenCalled();
  });

  it("honours a configured multi-domain allow-list", () => {
    process.env.MCP_WRITE_EMAIL_DOMAINS = "unic.com, example.org";
    expect(checkEmailDomain("a@example.org")).toBeNull();
    expect(checkEmailDomain("a@unic.com")).toBeNull();
    expect(checkEmailDomain("a@evil.com")).not.toBeNull();
  });
});

describe("cents plausibility guard", () => {
  const base = WRITE_TOOLS.create_access_tier.args as Record<string, unknown>;

  beforeEach(() => {
    vi.mocked(toolsCore.createTierCore).mockResolvedValue({
      ok: true,
      data: { tierId: 3, name: "Pro", toolName: "Acme", monthlyCostCents: 1900 },
      revalidate: [],
    });
  });

  it("refuses dollars-passed-as-dollars (19 meaning $19)", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("create_access_tier")!
      .handler({ ...base, monthlyCostCents: 19 }, WRITER);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("1900");
    expect(toolsCore.createTierCore).not.toHaveBeenCalled();
  });

  it("refuses an implausibly large price (dollars passed as cents)", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("create_access_tier")!
      .handler({ ...base, monthlyCostCents: 5_000_00_0 }, WRITER);
    expect(result.isError).toBe(true);
    expect(toolsCore.createTierCore).not.toHaveBeenCalled();
  });

  it("accepts 0 (a genuinely free tier)", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("create_access_tier")!
      .handler({ ...base, monthlyCostCents: 0 }, WRITER);
    expect(result.isError).toBeUndefined();
    expect(toolsCore.createTierCore).toHaveBeenCalled();
  });

  it("accepts a normal price", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("create_access_tier")!
      .handler({ ...base, monthlyCostCents: 1900 }, WRITER);
    expect(result.isError).toBeUndefined();
  });
});

describe("plan-token protocol", () => {
  const revokeArgs = WRITE_TOOLS.revoke_license.args as Record<string, unknown>;
  const preview = {
    assignmentId: 9,
    userEmail: "a@unic.com",
    toolName: "Acme",
    tierName: "Pro",
    monthlyReleasedCents: 1900,
    assignedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.mocked(assignmentsCore.revokeLicenseCore).mockImplementation(
      async (ctx) => ({
        ok: true,
        data: preview,
        revalidate: ctx.commit ? ["/assignments"] : [],
      }),
    );
  });

  it("returns a preview plus a token and writes nothing on the first call", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("revoke_license")!
      .handler(revokeArgs, WRITER);
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.planToken).toBeTypeOf("string");
    expect(body.preview.userEmail).toBe("a@unic.com");
    // Core was called only in preview mode.
    expect(assignmentsCore.revokeLicenseCore).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(assignmentsCore.revokeLicenseCore).mock.calls[0][0].commit,
    ).toBe(false);
  });

  it("commits when the token from that preview is passed back", async () => {
    const handlers = collectTools();
    const first = await handlers.get("revoke_license")!.handler(revokeArgs, WRITER);
    const { planToken } = JSON.parse(first.content[0].text);

    const second = await handlers
      .get("revoke_license")!
      .handler({ ...revokeArgs, planToken }, WRITER);
    expect(second.isError).toBeUndefined();
    const commitCall = vi
      .mocked(assignmentsCore.revokeLicenseCore)
      .mock.calls.find((c) => c[0].commit === true);
    expect(commitCall).toBeDefined();
  });

  it("rejects a fabricated token and never echoes the expected value", async () => {
    const handlers = collectTools();
    const result = await handlers
      .get("revoke_license")!
      .handler({ ...revokeArgs, planToken: "true" }, WRITER);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WITHOUT planToken");
    expect(
      vi.mocked(assignmentsCore.revokeLicenseCore).mock.calls.every(
        (c) => c[0].commit === false,
      ),
    ).toBe(true);
  });

  it("rejects a token issued to a different credential", async () => {
    const handlers = collectTools();
    const first = await handlers.get("revoke_license")!.handler(revokeArgs, WRITER);
    const { planToken } = JSON.parse(first.content[0].text);

    const otherAdmin = authInfo({
      userId: 99,
      email: "other@unic.com",
      role: "admin",
    });
    const result = await handlers
      .get("revoke_license")!
      .handler({ ...revokeArgs, planToken }, otherAdmin);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WITHOUT planToken");
  });

  it("rejects a token whose plan no longer matches the resolved state", async () => {
    const handlers = collectTools();
    const first = await handlers.get("revoke_license")!.handler(revokeArgs, WRITER);
    const { planToken } = JSON.parse(first.content[0].text);

    // The seat's cost changed between preview and commit.
    vi.mocked(assignmentsCore.revokeLicenseCore).mockImplementation(async () => ({
      ok: true,
      data: { ...preview, monthlyReleasedCents: 2900 },
      revalidate: [],
    }));

    const result = await handlers
      .get("revoke_license")!
      .handler({ ...revokeArgs, planToken }, WRITER);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WITHOUT planToken");
  });

  it("reports an already-revoked assignment as SUCCESS with noop, not an error", async () => {
    // An error here would contradict idempotentHint:true and, after a lost
    // response on a committed call, teach the agent the revoke had failed —
    // whose plausible recovery is deactivate_user (cascading every license).
    vi.mocked(assignmentsCore.revokeLicenseCore).mockResolvedValue({
      ok: true,
      data: preview,
      revalidate: [],
      noop: true,
    });
    const handlers = collectTools();
    const result = await handlers
      .get("revoke_license")!
      .handler(revokeArgs, WRITER);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).noop).toBe(true);
  });
});

describe("echo guards are structurally required", () => {
  it("every tool taking a numeric id also requires a human-readable echo", () => {
    const handlers = collectTools();
    // create_user has no id to mistake; every other tool must carry an echo.
    for (const name of TOOL_NAMES) {
      if (name === "create_user") continue;
      const args = WRITE_TOOLS[name].args as Record<string, unknown>;
      const hasEcho = Object.keys(args).some((k) => k.startsWith("expected"));
      expect(hasEcho, `${name} must take an expected* echo field`).toBe(true);
    }
    expect(handlers.size).toBe(TOOL_NAMES.length);
  });

  it("set_tier_price requires tool name, tier name AND current price", () => {
    // Tier names are unique only per tool and the real ones are generic
    // ("Business", "Enterprise"), so a tier-name echo alone does not identify a
    // tier — a wrong-tool tierId would sail through.
    const args = WRITE_TOOLS.set_tier_price.args as Record<string, unknown>;
    expect(args).toHaveProperty("expectedToolName");
    expect(args).toHaveProperty("expectedTierName");
    expect(args).toHaveProperty("expectedMonthlyCostCents");
  });
});
