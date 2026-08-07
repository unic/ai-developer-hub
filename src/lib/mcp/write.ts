/**
 * MCP write tools (043-mcp-write-tools).
 *
 * Nine tools over users, license assignments, and access tiers. Every one goes
 * through `authorizeWrite` (kill switch -> live admin role -> mcp:write scope ->
 * bound identity -> not an automation account) and then through a shared core in
 * `src/lib/core/*`, so there is exactly one implementation of each mutation and
 * the Server Actions cannot drift from what MCP does.
 *
 * Conventions that differ deliberately from the read tools:
 * - `readOnlyHint: false` on all of them, and `destructiveHint: true` on the
 *   three that destroy value (that flag is what makes an auto-approving client
 *   stop and ask the human).
 * - Every tool taking a numeric id also takes a human-readable echo of that row,
 *   verified against the row the core loaded.
 * - Secrets are refused as the first statement in the handler, before actor
 *   resolution and before any DB read, so the refusal text is provably free of
 *   the submitted value and under format.ts's control.
 * - "Already in the target state" is returned as SUCCESS with `noop: true`, not
 *   as an error — an error there contradicts `idempotentHint` and, after a lost
 *   response on a committed call, teaches the agent that the call failed.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  authorizeWrite,
  type HandlerAuthExtra,
  type McpWriteActor,
} from "@/lib/mcp/access";
import { errorResult, jsonResult, usd, type McpToolResult } from "@/lib/mcp/format";
import {
  issuePlanToken,
  planTokenErrorMessage,
  verifyPlanToken,
} from "@/lib/mcp/plan-token";
import type { ToolRegistrar } from "@/lib/mcp/tools";
import {
  MCP_CAPS,
  MCP_NO_SECRETS_MESSAGE,
  type CoreResult,
  type WriteContext,
  type WriteExpectations,
} from "@/lib/core/context";
import {
  assignLicenseCore,
  revokeLicenseCore,
  updateAssignmentCore,
} from "@/lib/core/assignments";
import {
  checkPlausibleCents,
  createTierCore,
  setTierPriceCore,
  updateTierCore,
} from "@/lib/core/tools";
import {
  createUserCore,
  deactivateUserCore,
  updateUserCore,
} from "@/lib/core/users";

const WRITE_HINT = " Requires an admin-role token with write access.";

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;
const WRITE_DESTRUCTIVE = {
  ...WRITE,
  destructiveHint: true,
  idempotentHint: true,
} as const;

const NEVER_SEND_SECRETS =
  "NEVER send an API key or license code to this tool — MCP cannot accept credentials. " +
  "For tools whose assignments carry a provisioned key, create the assignment at " +
  "/assignments in the Hub. ";

const emailField = z.string().email("Expected a valid email address");
const disciplineField = z.enum(["developer", "conception", "business"]);
const profileField = z.enum(["boost", "maxed", "indie"]);

/** Full calendar validation — a bare YYYY-MM-DD regex accepts 2026-02-31. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(value);
    return (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === y &&
      date.getUTCMonth() + 1 === m &&
      date.getUTCDate() === d
    );
  }, "Invalid calendar date");

const planTokenField = z
  .string()
  .min(1)
  .describe(
    "Omit on the first call to receive a preview and a planToken. Then call again " +
      "passing back the planToken string from that preview verbatim. This value " +
      "cannot be constructed or guessed — if you do not have one, call again without it.",
  );

/**
 * Declared as a plain optional string (so it stays visible in the JSON Schema
 * rather than being silently stripped by z.object) and rejected inside the
 * handler. A `z.refine(() => false)` decoy would reject at the SDK's input
 * validation boundary, outside our error formatting, where we cannot assert the
 * submitted key is absent from the response or the transport log.
 */
const secretDecoy = z.string().optional();

async function isAgentUser(userId: number): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isAgent: true },
  });
  return row?.isAgent ?? false;
}

function mcpContext(
  actor: McpWriteActor,
  commit: boolean,
  expect?: WriteExpectations,
): WriteContext {
  return {
    actorId: actor.userId,
    source: "mcp",
    caps: MCP_CAPS,
    commit,
    expect,
  };
}

/**
 * Best-effort cache invalidation. Wrapped because there is no precedent for
 * calling revalidatePath from an mcp-handler context, and a cache failure must
 * never fail a write that already committed.
 */
async function revalidateQuietly(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { revalidatePath } = await import("next/cache");
    for (const path of paths) revalidatePath(path);
  } catch {
    // Ignore — the DB is the source of truth; pages refresh on their own TTL.
  }
}

/** Collapse a core result into an MCP tool result. */
async function respond<T>(result: CoreResult<T>): Promise<McpToolResult> {
  if (!result.ok) return errorResult(result.error);
  await revalidateQuietly(result.revalidate);
  return jsonResult({
    ...result.data,
    ...(result.noop ? { noop: true } : {}),
    ...(result.warning ? { warning: result.warning } : {}),
  });
}

/** Wrap a handler with the write gate and error degradation. */
function gated<A>(
  run: (args: A, actor: McpWriteActor) => Promise<McpToolResult>,
): (args: A, extra: HandlerAuthExtra) => Promise<McpToolResult> {
  return async (args, extra) => {
    const auth = await authorizeWrite(extra?.authInfo, isAgentUser);
    if (!auth.ok) return errorResult(auth.message);
    try {
      return await run(args, auth.actor);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : "Unknown error");
    }
  };
}

/** Reject any secret-bearing field before anything else happens. */
function refuseSecrets(args: {
  apiKey?: string;
  licenseCode?: string;
}): McpToolResult | null {
  if (args.apiKey !== undefined || args.licenseCode !== undefined) {
    return errorResult(MCP_NO_SECRETS_MESSAGE);
  }
  return null;
}

/**
 * Preview-then-commit for a destructive tool. Runs the core with `commit: false`
 * to resolve and validate the plan, then either issues a token or verifies the
 * one supplied and re-runs with `commit: true`.
 */
async function previewOrCommit<T>(
  tool: string,
  actor: McpWriteActor,
  planToken: string | undefined,
  runCore: (ctx: WriteContext) => Promise<CoreResult<T>>,
  planOf: (preview: T) => unknown,
): Promise<McpToolResult> {
  const preview = await runCore(mcpContext(actor, false));
  if (!preview.ok) return errorResult(preview.error);

  // Nothing to do — report success so a retry after a lost response is not read
  // as a failure, and skip the token round trip entirely.
  if (preview.noop) {
    return jsonResult({ ...preview.data, noop: true });
  }

  const plan = planOf(preview.data);
  const nowSeconds = Date.now() / 1000;
  const subject = { clientId: actor.clientId, userId: actor.userId };

  if (!planToken) {
    return jsonResult({
      preview: preview.data,
      planToken: issuePlanToken(tool, plan, subject, nowSeconds),
      nextStep:
        `Review the preview above. To apply it, call ${tool} again with the same ` +
        "arguments plus the planToken exactly as given.",
    });
  }

  const verdict = verifyPlanToken(planToken, tool, plan, subject, nowSeconds);
  if (!verdict.ok) return errorResult(planTokenErrorMessage(verdict.reason));

  return respond(await runCore(mcpContext(actor, true)));
}

export function registerHubWriteTools(server: ToolRegistrar): void {
  // ---- Users ----

  server.registerTool(
    "create_user",
    {
      title: "Create user",
      description:
        "Create a Hub user with the viewer role. The account has no usable password; " +
        "an invite is prepared but NOT sent and the setup link is deliberately not " +
        "returned — send it from /users to the user to Send invite. The admin role " +
        "cannot be granted over MCP." +
        WRITE_HINT,
      inputSchema: {
        name: z.string().min(1).max(255),
        email: emailField,
        discipline: disciplineField,
        circle: z.string().max(100).optional(),
        githubUsername: z.string().max(255).optional(),
        profile: profileField.optional(),
      },
      annotations: WRITE,
    },
    gated(async (args, actor) => {
      const domainRefusal = checkEmailDomain(args.email);
      if (domainRefusal) return errorResult(domainRefusal);

      const result = await createUserCore(
        mcpContext(actor, true),
        { ...args, role: "viewer" },
        // caps.credentials is false, so the core mints the token (leaving the
        // account in exactly the state a UI-created user is in) but withholds
        // the URL from the response.
        mintInvite,
      );
      if (!result.ok) return errorResult(result.error);
      await revalidateQuietly(result.revalidate);
      return jsonResult({
        userId: result.data.userId,
        email: result.data.email,
        role: result.data.role,
        canSignIn: false,
        nextStep:
          "This account has no usable password yet. Send the invite from /users — " +
          `select ${result.data.email} — Send invite.`,
      });
    }),
  );

  server.registerTool(
    "update_user",
    {
      title: "Update user",
      description:
        "Update a user's name, circle, discipline, GitHub username, or profile. " +
        "Role, status, email and password are NOT settable over MCP: role confers " +
        "privilege, and email is where every password-recovery link is delivered. " +
        "Pass expectedEmail so a stale or guessed userId cannot edit the wrong person." +
        WRITE_HINT,
      inputSchema: {
        userId: z.number().int().positive(),
        expectedEmail: emailField,
        name: z.string().min(1).max(255).optional(),
        circle: z.string().max(100).nullable().optional(),
        discipline: disciplineField.optional(),
        githubUsername: z.string().max(255).optional(),
        profile: profileField.nullable().optional(),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    gated(async ({ userId, expectedEmail, ...updates }, actor) =>
      respond(
        await updateUserCore(
          mcpContext(actor, true, { userEmail: expectedEmail }),
          { id: userId, ...updates },
        ),
      ),
    ),
  );

  server.registerTool(
    "deactivate_user",
    {
      title: "Deactivate user",
      description:
        "Deactivate a user AND revoke every active license they hold, in one " +
        "transaction. Call without planToken first to see exactly which licenses " +
        "will be revoked and the monthly cost released. Reactivation is not " +
        "available over MCP (it would restore the person's old password and " +
        "re-arm their existing tokens) — do that in the Hub UI." +
        WRITE_HINT,
      inputSchema: {
        userId: z.number().int().positive(),
        expectedEmail: emailField,
        planToken: planTokenField.optional(),
      },
      annotations: WRITE_DESTRUCTIVE,
    },
    gated(async ({ userId, expectedEmail, planToken }, actor) =>
      previewOrCommit(
        "deactivate_user",
        actor,
        planToken,
        (ctx) =>
          deactivateUserCore(
            { ...ctx, expect: { userEmail: expectedEmail } },
            { id: userId },
          ),
        (preview) => ({
          userId,
          email: preview.email,
          revokedAssignmentIds: preview.revoked
            .map((r) => r.assignmentId)
            .sort((a, b) => a - b),
        }),
      ),
    ),
  );

  // ---- License assignments ----

  server.registerTool(
    "assign_license",
    {
      title: "Assign license",
      description:
        NEVER_SEND_SECRETS +
        "Give a user a license for a tool at a specific tier. The monthly cost is " +
        "snapshotted from the tier, never from your input. If the user already holds " +
        "this tool, this refuses — use update_assignment to change their tier instead." +
        WRITE_HINT,
      inputSchema: {
        userId: z.number().int().positive(),
        expectedUserEmail: emailField,
        toolId: z.number().int().positive(),
        tierId: z.number().int().positive(),
        workspace: z.string().max(200).optional(),
        apiKey: secretDecoy,
        licenseCode: secretDecoy,
      },
      annotations: WRITE,
    },
    gated(async (args, actor) => {
      const refusal = refuseSecrets(args);
      if (refusal) return refusal;

      const result = await assignLicenseCore(
        mcpContext(actor, true, { userEmail: args.expectedUserEmail }),
        {
          userId: args.userId,
          toolId: args.toolId,
          tierId: args.tierId,
          workspace: args.workspace,
        },
      );
      if (!result.ok) return errorResult(result.error);
      await revalidateQuietly(result.revalidate);
      const d = result.data;
      return jsonResult({
        assignmentId: d.assignmentId,
        userEmail: d.userEmail,
        toolName: d.toolName,
        tierName: d.tierName,
        ...usd("monthlyCost", d.monthlyCostCents),
        userCanSignIn: d.userCanSignIn,
        ...(d.userCanSignIn
          ? {}
          : {
              nextStep:
                `${d.userEmail} cannot sign in yet — no invite has been delivered. ` +
                "This seat is billable regardless. Send the invite from /users.",
            }),
      });
    }),
  );

  server.registerTool(
    "update_assignment",
    {
      title: "Update assignment",
      description:
        NEVER_SEND_SECRETS +
        "Change an existing active assignment's tier (the cost snapshot is re-taken " +
        "from the new tier), its assigned date, or its workspace. This is the tool to " +
        "use when a user already holds the tool — not assign_license." +
        WRITE_HINT,
      inputSchema: {
        assignmentId: z.number().int().positive(),
        expectedUserEmail: emailField,
        tierId: z.number().int().positive().optional(),
        assignedAt: calendarDate.optional(),
        workspace: z.string().max(200).optional(),
        apiKey: secretDecoy,
        licenseCode: secretDecoy,
      },
      annotations: WRITE_IDEMPOTENT,
    },
    gated(async (args, actor) => {
      const refusal = refuseSecrets(args);
      if (refusal) return refusal;

      const result = await updateAssignmentCore(
        mcpContext(actor, true, { userEmail: args.expectedUserEmail }),
        {
          id: args.assignmentId,
          tierId: args.tierId,
          assignedAt: args.assignedAt,
          workspace: args.workspace,
        },
      );
      if (!result.ok) return errorResult(result.error);
      await revalidateQuietly(result.revalidate);
      return jsonResult({
        assignmentId: result.data.assignmentId,
        userEmail: result.data.userEmail,
        changedFields: result.data.changedFields,
        ...usd("monthlyCost", result.data.monthlyCostCents),
        ...(result.noop ? { noop: true } : {}),
        ...(result.warning ? { warning: result.warning } : {}),
      });
    }),
  );

  server.registerTool(
    "revoke_license",
    {
      title: "Revoke license",
      description:
        "Revoke one active license assignment. The historical cost snapshot is kept " +
        "so past periods still reconcile. Call without planToken first to see whose " +
        "license it is and what monthly cost is released." +
        WRITE_HINT,
      inputSchema: {
        assignmentId: z.number().int().positive(),
        expectedUserEmail: emailField,
        planToken: planTokenField.optional(),
      },
      annotations: WRITE_DESTRUCTIVE,
    },
    gated(async ({ assignmentId, expectedUserEmail, planToken }, actor) =>
      previewOrCommit(
        "revoke_license",
        actor,
        planToken,
        (ctx) =>
          revokeLicenseCore(
            { ...ctx, expect: { userEmail: expectedUserEmail } },
            { id: assignmentId },
          ),
        (preview) => ({
          assignmentId,
          userEmail: preview.userEmail,
          monthlyReleasedCents: preview.monthlyReleasedCents,
        }),
      ),
    ),
  );

  // ---- Access tiers ----

  server.registerTool(
    "create_access_tier",
    {
      title: "Create access tier",
      description:
        "Add a pricing tier to an existing AI tool. monthlyCostCents is in CENTS — " +
        "$19.00/month is 1900. Creating a tier affects no existing assignment; use " +
        "set_tier_price to change the price of a tier people already hold." +
        WRITE_HINT,
      inputSchema: {
        toolId: z.number().int().positive(),
        expectedToolName: z.string().min(1),
        name: z.string().min(1).max(100),
        monthlyCostCents: z.number().int().min(0),
        description: z.string().max(5000).optional(),
      },
      annotations: WRITE,
    },
    gated(async (args, actor) => {
      const implausible = checkPlausibleCents(args.monthlyCostCents);
      if (implausible) return errorResult(implausible);

      const result = await createTierCore(
        mcpContext(actor, true, { toolName: args.expectedToolName }),
        {
          toolId: args.toolId,
          name: args.name,
          monthlyCostCents: args.monthlyCostCents,
          description: args.description,
        },
      );
      if (!result.ok) return errorResult(result.error);
      await revalidateQuietly(result.revalidate);
      return jsonResult({
        tierId: result.data.tierId,
        name: result.data.name,
        toolName: result.data.toolName,
        ...usd("monthlyCost", result.data.monthlyCostCents),
      });
    }),
  );

  server.registerTool(
    "update_access_tier",
    {
      title: "Update access tier",
      description:
        "Rename a tier, change its description, or activate/deactivate it. The PRICE " +
        "is deliberately not settable here — changing it rewrites the cost snapshot on " +
        "every active assignment of the tier, so it has its own tool (set_tier_price). " +
        "Deactivating is refused while anyone still holds the tier." +
        WRITE_HINT,
      inputSchema: {
        tierId: z.number().int().positive(),
        expectedToolName: z.string().min(1),
        expectedTierName: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(5000).optional(),
        isActive: z.boolean().optional(),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    gated(
      async (
        { tierId, expectedToolName, expectedTierName, ...updates },
        actor,
      ) =>
        respond(
          await updateTierCore(
            mcpContext(actor, true, {
              toolName: expectedToolName,
              tierName: expectedTierName,
            }),
            { id: tierId, ...updates },
          ),
        ),
    ),
  );

  server.registerTool(
    "set_tier_price",
    {
      title: "Set access tier price",
      description:
        "Change a tier's monthly price AND rewrite the cost snapshot on every ACTIVE " +
        "assignment of that tier, which moves every downstream spend report, budget " +
        "burn-up and forecast. Revoked assignments keep their historical price. " +
        "monthlyCostCents is in CENTS — $19.00/month is 1900. Call without planToken " +
        "first: the preview lists every affected seat and the org monthly delta. " +
        "expectedMonthlyCostCents must be the tier's CURRENT price, which also catches " +
        "a stale read before anything is previewed." +
        WRITE_HINT,
      inputSchema: {
        tierId: z.number().int().positive(),
        expectedToolName: z.string().min(1),
        expectedTierName: z.string().min(1),
        expectedMonthlyCostCents: z.number().int().min(0),
        monthlyCostCents: z.number().int().min(0),
        planToken: planTokenField.optional(),
      },
      annotations: WRITE_DESTRUCTIVE,
    },
    gated(async (args, actor) => {
      const implausible = checkPlausibleCents(args.monthlyCostCents);
      if (implausible) return errorResult(implausible);

      return previewOrCommit(
        "set_tier_price",
        actor,
        args.planToken,
        (ctx) =>
          setTierPriceCore(
            {
              ...ctx,
              expect: {
                toolName: args.expectedToolName,
                tierName: args.expectedTierName,
                monthlyCostCents: args.expectedMonthlyCostCents,
              },
            },
            { tierId: args.tierId, monthlyCostCents: args.monthlyCostCents },
          ),
        // Bound to the tier and the price basis only — NOT the affected-seat id
        // set, so a benign concurrent assignment does not force a re-preview
        // while a concurrent price move still hard-fails.
        (preview) => ({
          tierId: args.tierId,
          priceBeforeCents: preview.priceBeforeCents,
          priceAfterCents: preview.priceAfterCents,
        }),
      );
    }),
  );
}

// ---- create_user email allow-list ----

/**
 * Constrain agent-created accounts to the org's own domain(s). Without this, an
 * agent following instructions embedded in an email thread or ticket could create
 * an account on an attacker-controlled address; the next time an admin runs the
 * batch invite (which selects every user with mustChangePassword = true) a live
 * setup link would be delivered to it.
 */
export function allowedEmailDomains(): string[] {
  const raw = process.env.MCP_WRITE_EMAIL_DOMAINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
  }
  return ["unic.com"];
}

export function checkEmailDomain(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  const allowed = allowedEmailDomains();
  if (allowed.includes(domain)) return null;
  return (
    `Refusing to create an account for "${email}": only ${allowed
      .map((d) => `@${d}`)
      .join(", ")} addresses can be created over MCP. ` +
    "Create external or contractor accounts at /users in the Hub."
  );
}

async function mintInvite(userId: number): Promise<{ inviteUrl: string }> {
  const { createInviteTokenForUser } = await import("@/lib/invite");
  return createInviteTokenForUser(userId);
}
