/**
 * AI tool + access tier write cores (043-mcp-write-tools).
 *
 * Extracted from src/actions/tools.ts so the same logic serves the
 * session-backed Server Actions and the MCP write tools. Behavior is preserved
 * verbatim except where a comment says otherwise.
 *
 * The load-bearing function here is `setTierPriceCore`: spec 037 established
 * that every spend aggregation sums `license_assignments.cost_at_assignment_cents`,
 * so a tier price change has to rewrite that snapshot on every ACTIVE assignment
 * or every report keeps showing the old price. That transaction moves real money
 * numbers, which is the main reason this refactor exists rather than a second
 * copy of it living in the MCP layer.
 */

import { and, count, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { accessTiers, aiTools, licenseAssignments, users } from "@/lib/db/schema";
import { recordCreation, recordStatusChange, recordUpdate } from "@/lib/history";
import { COST_SURFACE_PATHS } from "@/lib/assignments/cost-paths";
import { isSyncManagedToolName } from "@/lib/assignments/sync-authority";
import {
  coreErr,
  coreOk,
  targetMismatchMessage,
  type CoreResult,
  type WriteContext,
} from "@/lib/core/context";
import {
  tierSchema,
  toolSchema,
  updateTierSchema,
  updateToolSchema,
} from "@/lib/validators";

/**
 * Repricing above this many active seats is refused over MCP and pushed to the
 * Hub UI. Bounds the per-row audit inserts and makes a mis-targeted reprice a
 * refusal rather than an org-wide rewrite. Policy number, not an engineering
 * limit — see the plan's open questions.
 */
export const MAX_REPRICE_ROWS = 250;

/**
 * A monthly seat price this high almost certainly means dollars were passed as
 * cents ($2,000/seat/month). Claude Enterprise is ~$150/seat and Copilot
 * Enterprise is $39/seat, so this leaves a wide margin over the real catalogue.
 */
export const IMPLAUSIBLE_PRICE_CENTS = 200_000;

/**
 * Refusal for a tier whose price an automated sync owns and would silently
 * revert. `copilot-sync.ts` hardcodes `business: 1900, enterprise: 3900` and
 * re-propagates to every active assignment on the `0 6 * * *` cron, writing no
 * audit rows — so a "successful" MCP price change on these tiers becomes false
 * within 24 hours.
 *
 * Which tool that is comes from @/lib/assignments/sync-authority (spec 042),
 * which is the single authority on sync ownership; this module used to keep its
 * own name set, and two lists of the same tool names is exactly the drift that
 * module exists to prevent.
 */
export const SYNC_OWNED_PRICE_MESSAGE =
  "This tier's price is owned by the daily GitHub Copilot billing sync " +
  "(src/lib/copilot-sync.ts, 06:00 UTC) and any change here would be silently " +
  "reverted within 24 hours. Change it in GitHub billing instead.";

/**
 * Two-sided cents sanity check. The high side catches dollars-passed-as-cents;
 * the low side catches the mirror error (`19` for a $19 seat), which passes
 * `min(0)` and understates that tool's spend 100x through the propagation path.
 * Exactly 0 stays legal — free tiers exist.
 */
export function checkPlausibleCents(cents: number): string | null {
  if (cents > 0 && cents < 100) {
    return (
      `${cents} means $${(cents / 100).toFixed(2)}/month. This field is CENTS — ` +
      `if you meant $${cents}.00/month, pass ${cents * 100}.`
    );
  }
  if (cents > IMPLAUSIBLE_PRICE_CENTS) {
    return (
      `${cents} cents is $${(cents / 100).toLocaleString()}/month per seat, which reads ` +
      `as dollars passed as cents. This field is CENTS — $19.00/month is 1900. ` +
      `If the price really is this high, make the change in the Hub UI.`
    );
  }
  return null;
}

// ---- Tools ----

export async function createToolCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<{ toolId: number; name: string; vendor: string }>> {
  const parsed = toolSchema.safeParse(input);
  if (!parsed.success) {
    return coreErr("Validation failed", {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    });
  }

  const { name, vendor, description, maxLicenses } = parsed.data;

  // The action has no app-level duplicate check, so ai_tools_name_idx surfaces
  // as a raw Postgres error. Pre-check for a friendly message; the race is still
  // caught by the index (mapped below).
  const duplicate = await db.query.aiTools.findFirst({
    where: eq(aiTools.name, name),
    columns: { id: true },
  });
  if (duplicate) {
    return coreErr(`A tool named "${name}" already exists`);
  }

  if (!ctx.commit) {
    return coreOk({ toolId: 0, name, vendor });
  }

  let toolId: number;
  try {
    toolId = await db.transaction(async (tx) => {
      const [tool] = await tx
        .insert(aiTools)
        .values({
          name,
          vendor,
          description: description ?? null,
          maxLicenses: maxLicenses ?? null,
        })
        .returning({ id: aiTools.id });
      await recordCreation("ai_tool", tool.id, ctx.actorId, {
        tx,
        source: ctx.source,
      });
      return tool.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return coreErr(`A tool named "${name}" already exists`);
    }
    throw err;
  }

  return coreOk({ toolId, name, vendor }, ["/tools"]);
}

export async function updateToolCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<{ toolId: number; changedFields: string[] }>> {
  const parsed = updateToolSchema.safeParse(input);
  if (!parsed.success) return coreErr("Validation failed");

  const { id, ...updates } = parsed.data;

  const existing = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, id),
  });
  if (!existing) return coreErr("Tool not found");

  const mismatch = checkToolNameEcho(ctx, existing.name);
  if (mismatch) return mismatch;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    const duplicate = await db.query.aiTools.findFirst({
      where: and(eq(aiTools.name, updates.name), ne(aiTools.id, id)),
      columns: { id: true },
    });
    if (duplicate) return coreErr(`A tool named "${updates.name}" already exists`);
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (updates.vendor !== undefined && updates.vendor !== existing.vendor) {
    changes.vendor = { old: existing.vendor, new: updates.vendor };
    values.vendor = updates.vendor;
  }
  if (
    updates.description !== undefined &&
    updates.description !== existing.description
  ) {
    changes.description = {
      old: existing.description,
      new: updates.description,
    };
    values.description = updates.description;
  }
  if (
    updates.maxLicenses !== undefined &&
    updates.maxLicenses !== existing.maxLicenses
  ) {
    changes.maxLicenses = {
      old: existing.maxLicenses,
      new: updates.maxLicenses,
    };
    values.maxLicenses = updates.maxLicenses;
  }

  const changedFields = Object.keys(changes);
  if (changedFields.length === 0) {
    return coreOk({ toolId: id, changedFields }, [], { noop: true });
  }

  // Non-blocking, matching the action (which imposes no check) rather than
  // inventing a refusal the UI would not produce.
  let warning: string | undefined;
  if (typeof values.maxLicenses === "number") {
    const [activeCount] = await db
      .select({ count: count() })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.toolId, id),
          eq(licenseAssignments.status, "active"),
        ),
      );
    if (activeCount.count > (values.maxLicenses as number)) {
      warning =
        `maxLicenses is now ${values.maxLicenses} but ${activeCount.count} active ` +
        `assignments already exist — the tool is over capacity.`;
    }
  }

  if (!ctx.commit) {
    return coreOk({ toolId: id, changedFields }, [], { warning });
  }

  await db.transaction(async (tx) => {
    await tx.update(aiTools).set(values).where(eq(aiTools.id, id));
    await recordUpdate("ai_tool", id, ctx.actorId, changes, {
      tx,
      source: ctx.source,
    });
  });

  return coreOk({ toolId: id, changedFields }, ["/tools", `/tools/${id}`], {
    warning,
  });
}

export async function archiveToolCore(
  ctx: WriteContext,
  input: { id: number },
): Promise<
  CoreResult<{ toolId: number; name: string; previousStatus: string }>
> {
  const existing = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, input.id),
  });
  if (!existing) return coreErr("Tool not found");

  const mismatch = checkToolNameEcho(ctx, existing.name);
  if (mismatch) return mismatch;

  // The action re-writes and re-audits an already-archived row silently.
  if (existing.status === "archived") {
    return coreOk(
      { toolId: input.id, name: existing.name, previousStatus: existing.status },
      [],
      { noop: true },
    );
  }

  // FR-019
  const holders = await db
    .select({ email: users.email })
    .from(licenseAssignments)
    .innerJoin(users, eq(users.id, licenseAssignments.userId))
    .where(
      and(
        eq(licenseAssignments.toolId, input.id),
        eq(licenseAssignments.status, "active"),
      ),
    )
    .limit(11);

  if (holders.length > 0) {
    const shown = holders.slice(0, 10).map((h) => h.email);
    const andMore = holders.length > 10 ? " and more" : "";
    return coreErr(
      `Cannot archive tool with active license assignments. Held by: ` +
        `${shown.join(", ")}${andMore}. Revoke these first.`,
    );
  }

  if (!ctx.commit) {
    return coreOk({
      toolId: input.id,
      name: existing.name,
      previousStatus: existing.status,
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(aiTools)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(aiTools.id, input.id));
    await recordStatusChange(
      "ai_tool",
      input.id,
      ctx.actorId,
      existing.status,
      "archived",
      { tx, source: ctx.source },
    );
  });

  return coreOk(
    { toolId: input.id, name: existing.name, previousStatus: existing.status },
    ["/tools", `/tools/${input.id}`],
  );
}

// ---- Tiers ----

export async function createTierCore(
  ctx: WriteContext,
  input: unknown,
): Promise<
  CoreResult<{
    tierId: number;
    name: string;
    toolName: string;
    monthlyCostCents: number;
  }>
> {
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) {
    return coreErr("Validation failed", {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    });
  }

  const { toolId, name, description, monthlyCostCents } = parsed.data;

  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, toolId),
    columns: { id: true, name: true },
  });
  if (!tool) return coreErr("Tool not found");

  const mismatch = checkToolNameEcho(ctx, tool.name);
  if (mismatch) return mismatch;

  // NOTE: the cents plausibility guard is applied at the MCP edge, not here —
  // it is an LLM-specific narrowing (like the date regex on update_assignment),
  // and applying it in the core would change UI behavior for legitimately
  // unusual prices. See checkPlausibleCents' callers in src/lib/mcp/write.ts.

  const existingTier = await db.query.accessTiers.findFirst({
    where: and(eq(accessTiers.toolId, toolId), eq(accessTiers.name, name)),
    columns: { id: true },
  });
  if (existingTier) {
    return coreErr("A tier with this name already exists for this tool");
  }

  if (!ctx.commit) {
    return coreOk({
      tierId: 0,
      name,
      toolName: tool.name,
      monthlyCostCents,
    });
  }

  let tierId: number;
  try {
    tierId = await db.transaction(async (tx) => {
      const [tier] = await tx
        .insert(accessTiers)
        .values({
          toolId,
          name,
          description: description ?? null,
          monthlyCostCents,
        })
        .returning({ id: accessTiers.id });
      await recordCreation("access_tier", tier.id, ctx.actorId, {
        tx,
        source: ctx.source,
      });
      return tier.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return coreErr("A tier with this name already exists for this tool");
    }
    throw err;
  }

  return coreOk(
    { tierId, name, toolName: tool.name, monthlyCostCents },
    [`/tools/${toolId}`],
  );
}

/**
 * Tier metadata only — name, description, isActive. The price lives in
 * `setTierPriceCore` so the one write that rewrites cost snapshots org-wide
 * cannot be triggered as a side effect of a rename.
 */
export async function updateTierCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<{ tierId: number; changedFields: string[] }>> {
  const parsed = updateTierSchema.safeParse(input);
  if (!parsed.success) return coreErr("Validation failed");

  const { id, ...updates } = parsed.data;

  if (updates.monthlyCostCents !== undefined) {
    // Structurally unreachable from the MCP tool (the field is absent from its
    // schema); this is the guard for any other caller.
    return coreErr(
      "Use setTierPriceCore to change a tier price — it must propagate the new " +
        "cost snapshot to every active assignment.",
    );
  }

  const existing = await db.query.accessTiers.findFirst({
    where: eq(accessTiers.id, id),
    with: { tool: { columns: { id: true, name: true } } },
  });
  if (!existing) return coreErr("Tier not found");

  const mismatch =
    checkToolNameEcho(ctx, existing.tool.name) ?? checkTierNameEcho(ctx, existing.name);
  if (mismatch) return mismatch;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    const duplicate = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.toolId, existing.toolId),
        eq(accessTiers.name, updates.name),
        ne(accessTiers.id, id),
      ),
      columns: { id: true },
    });
    if (duplicate) {
      return coreErr("A tier with this name already exists for this tool");
    }
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (
    updates.description !== undefined &&
    updates.description !== existing.description
  ) {
    changes.description = {
      old: existing.description,
      new: updates.description,
    };
    values.description = updates.description;
  }
  if (updates.isActive !== undefined && updates.isActive !== existing.isActive) {
    if (!updates.isActive) {
      const holders = await db
        .select({ email: users.email })
        .from(licenseAssignments)
        .innerJoin(users, eq(users.id, licenseAssignments.userId))
        .where(
          and(
            eq(licenseAssignments.tierId, id),
            eq(licenseAssignments.status, "active"),
          ),
        )
        .limit(11);
      if (holders.length > 0) {
        const shown = holders.slice(0, 10).map((h) => h.email);
        const andMore = holders.length > 10 ? " and more" : "";
        return coreErr(
          `Cannot deactivate tier with active assignments. Held by: ` +
            `${shown.join(", ")}${andMore}.`,
        );
      }
    }
    changes.isActive = { old: existing.isActive, new: updates.isActive };
    values.isActive = updates.isActive;
  }

  const changedFields = Object.keys(changes);
  if (changedFields.length === 0) {
    return coreOk({ tierId: id, changedFields }, [], { noop: true });
  }

  if (!ctx.commit) return coreOk({ tierId: id, changedFields });

  await db.transaction(async (tx) => {
    await tx.update(accessTiers).set(values).where(eq(accessTiers.id, id));
    await recordUpdate("access_tier", id, ctx.actorId, changes, {
      tx,
      source: ctx.source,
    });
  });

  return coreOk({ tierId: id, changedFields }, [`/tools/${existing.toolId}`]);
}

export interface RepricedSeat {
  assignmentId: number;
  userEmail: string;
  beforeCents: number;
  afterCents: number;
}

export interface SetTierPriceResult {
  tierId: number;
  tierName: string;
  toolId: number;
  toolName: string;
  priceBeforeCents: number;
  priceAfterCents: number;
  activeAssignmentsRepriced: number;
  orgMonthlyBeforeCents: number;
  orgMonthlyAfterCents: number;
  affected: RepricedSeat[];
}

/**
 * Change a tier price and propagate the new cost snapshot to every ACTIVE
 * assignment on that tier (spec 037). Inactive assignments keep their historical
 * snapshot on purpose — that is what makes past periods reproducible.
 */
export async function setTierPriceCore(
  ctx: WriteContext,
  input: { tierId: number; monthlyCostCents: number },
): Promise<CoreResult<SetTierPriceResult>> {
  const { tierId, monthlyCostCents } = input;

  const existing = await db.query.accessTiers.findFirst({
    where: eq(accessTiers.id, tierId),
    with: { tool: { columns: { id: true, name: true } } },
  });
  if (!existing) return coreErr("Tier not found");

  const mismatch =
    checkToolNameEcho(ctx, existing.tool.name) ??
    checkTierNameEcho(ctx, existing.name) ??
    checkPriceEcho(ctx, existing.monthlyCostCents);
  if (mismatch) return mismatch;

  // Caps first, so the UI path costs nothing. The PURE name check, not the async
  // isSyncManagedTool: a connection-gated price refusal would let MCP reprice
  // Copilot tiers during a momentary sync outage and get reverted the moment it
  // came back — the exact "success that silently reverts" this guardrail exists
  // to prevent — and it would add a query to a path that already holds FOR
  // UPDATE locks. This is the tier-PRICE policy; the per-seat tier policy lives
  // in src/lib/core/assignments.ts and is unconditional (see buildTierChange).
  if (!ctx.caps.syncOwnedFields && isSyncManagedToolName(existing.tool.name)) {
    return coreErr(SYNC_OWNED_PRICE_MESSAGE);
  }

  if (monthlyCostCents === existing.monthlyCostCents) {
    return coreOk(
      {
        tierId,
        tierName: existing.name,
        toolId: existing.tool.id,
        toolName: existing.tool.name,
        priceBeforeCents: existing.monthlyCostCents,
        priceAfterCents: monthlyCostCents,
        activeAssignmentsRepriced: 0,
        orgMonthlyBeforeCents: 0,
        orgMonthlyAfterCents: 0,
        affected: [],
      },
      [],
      { noop: true },
    );
  }

  // Preview reads without a lock; commit re-reads FOR UPDATE inside the tx (see
  // below) so the audit rows can never describe a different row set than the one
  // actually rewritten.
  const seats = await db
    .select({
      assignmentId: licenseAssignments.id,
      userEmail: users.email,
      beforeCents: licenseAssignments.costAtAssignmentCents,
    })
    .from(licenseAssignments)
    .innerJoin(users, eq(users.id, licenseAssignments.userId))
    .where(
      and(
        eq(licenseAssignments.tierId, tierId),
        eq(licenseAssignments.status, "active"),
      ),
    );

  if (seats.length > MAX_REPRICE_ROWS) {
    return coreErr(
      `${seats.length} active assignments would be repriced (limit ` +
        `${MAX_REPRICE_ROWS}). Make a change this large in the Hub UI at ` +
        `/tools/${existing.tool.id}.`,
    );
  }

  const affected: RepricedSeat[] = seats.map((s) => ({
    assignmentId: s.assignmentId,
    userEmail: s.userEmail,
    beforeCents: s.beforeCents,
    afterCents: monthlyCostCents,
  }));
  const orgMonthlyBeforeCents = seats.reduce((sum, s) => sum + s.beforeCents, 0);
  const orgMonthlyAfterCents = monthlyCostCents * seats.length;

  const result: SetTierPriceResult = {
    tierId,
    tierName: existing.name,
    toolId: existing.tool.id,
    toolName: existing.tool.name,
    priceBeforeCents: existing.monthlyCostCents,
    priceAfterCents: monthlyCostCents,
    activeAssignmentsRepriced: seats.length,
    orgMonthlyBeforeCents,
    orgMonthlyAfterCents,
    affected,
  };

  if (!ctx.commit) return coreOk(result);

  const conflict = await db.transaction(async (tx) => {
    // Re-read the price under the row lock: a concurrent change (the Copilot
    // sync, or another admin) must hard-fail rather than silently reprice from a
    // basis the caller never saw.
    const [locked] = await tx
      .select({ monthlyCostCents: accessTiers.monthlyCostCents })
      .from(accessTiers)
      .where(eq(accessTiers.id, tierId))
      .for("update");
    if (!locked) return "Tier not found";
    if (locked.monthlyCostCents !== existing.monthlyCostCents) {
      return (
        `The tier price changed to ${locked.monthlyCostCents} cents while this ` +
        `change was being prepared. Re-read the tier and retry.`
      );
    }

    // THIS is the row set the update below rewrites, so it is also the row set
    // the audit rows describe.
    const locking = await tx
      .select({
        id: licenseAssignments.id,
        beforeCents: licenseAssignments.costAtAssignmentCents,
      })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.tierId, tierId),
          eq(licenseAssignments.status, "active"),
        ),
      )
      .for("update");

    if (locking.length > MAX_REPRICE_ROWS) {
      return (
        `${locking.length} active assignments would be repriced (limit ` +
        `${MAX_REPRICE_ROWS}).`
      );
    }

    await tx
      .update(accessTiers)
      .set({ monthlyCostCents, updatedAt: new Date() })
      .where(eq(accessTiers.id, tierId));

    await recordUpdate(
      "access_tier",
      tierId,
      ctx.actorId,
      {
        monthlyCostCents: {
          old: existing.monthlyCostCents,
          new: monthlyCostCents,
        },
      },
      { tx, source: ctx.source },
    );

    if (locking.length > 0) {
      await tx
        .update(licenseAssignments)
        .set({ costAtAssignmentCents: monthlyCostCents, updatedAt: new Date() })
        .where(
          and(
            eq(licenseAssignments.tierId, tierId),
            eq(licenseAssignments.status, "active"),
          ),
        );

      // The bulk rewrite is completely silent in change_history today. Safe to
      // audit per row precisely because MAX_REPRICE_ROWS bounds the count.
      for (const row of locking) {
        await recordUpdate(
          "license_assignment",
          row.id,
          ctx.actorId,
          {
            costAtAssignmentCents: {
              old: row.beforeCents,
              new: monthlyCostCents,
            },
          },
          { tx, source: ctx.source },
        );
      }
    }

    return null;
  });

  if (conflict) return coreErr(conflict);

  return coreOk(result, [
    ...COST_SURFACE_PATHS,
    `/tools/${existing.tool.id}`,
  ]);
}

// ---- Echo verification ----

function checkToolNameEcho(
  ctx: WriteContext,
  actual: string,
): CoreResult<never> | null {
  const expected = ctx.expect?.toolName;
  if (expected === undefined) return null;
  if (expected.trim().toLowerCase() === actual.trim().toLowerCase()) return null;
  return coreErr(targetMismatchMessage("expectedToolName", expected, actual));
}

function checkTierNameEcho(
  ctx: WriteContext,
  actual: string,
): CoreResult<never> | null {
  const expected = ctx.expect?.tierName;
  if (expected === undefined) return null;
  if (expected.trim().toLowerCase() === actual.trim().toLowerCase()) return null;
  return coreErr(targetMismatchMessage("expectedTierName", expected, actual));
}

function checkPriceEcho(
  ctx: WriteContext,
  actual: number,
): CoreResult<never> | null {
  const expected = ctx.expect?.monthlyCostCents;
  if (expected === undefined) return null;
  if (expected === actual) return null;
  return coreErr(
    targetMismatchMessage(
      "expectedMonthlyCostCents",
      String(expected),
      `${actual} cents`,
    ),
  );
}

/**
 * Drizzle 0.45 wraps driver errors, so the Postgres code lives on `error.cause`
 * rather than the thrown error — walk the chain.
 */
export function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; cursor && depth < 5; depth++) {
    if (
      typeof cursor === "object" &&
      "code" in cursor &&
      (cursor as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/** Named so the assignments core can map the partial-unique index by name. */
export function isUniqueViolationOn(err: unknown, indexName: string): boolean {
  if (!isUniqueViolation(err)) return false;
  let cursor: unknown = err;
  for (let depth = 0; cursor && depth < 5; depth++) {
    const detail = cursor as { constraint?: unknown; message?: unknown };
    if (
      detail.constraint === indexName ||
      (typeof detail.message === "string" && detail.message.includes(indexName))
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}
