/**
 * Audit-trail writers for `change_history` (043-mcp-write-tools).
 *
 * These live in a plain module — deliberately NOT `"use server"`. Every export
 * of a `"use server"` file is a client-callable RPC endpoint, and these
 * functions take `changedBy` as a parameter with no auth check of their own: as
 * Server Actions they were an audit-forgery primitive. The read side
 * (`getEntityHistory`) stays in `src/actions/history.ts` because Server
 * Components import it from there.
 *
 * `source` is REQUIRED on every call via the `HistoryOptions` interface below,
 * so the compiler — not the database — forces every call site through these
 * helpers (~44 of them) to state it explicitly and prevents a forgetful call
 * site from silently getting labelled a human UI edit. The column itself does
 * carry a DB default (`'ui'`, added by migration 0031) but that exists only
 * for deploy safety; it backstops the two raw `db.insert(changeHistory)`
 * sites that bypass these helpers (`src/actions/budget.ts` and
 * `src/actions/budget-extensions.ts`), both of which also pass `source`
 * explicitly.
 */

import { db } from "@/lib/db";
import { changeHistory } from "@/lib/db/schema";

/** Where a mutation originated. Written to `change_history.source`. */
export type ChangeSource = "ui" | "mcp" | "sync" | "ingest";

/** The slice of the db client these helpers need — satisfied by a tx too. */
export type HistoryClient = Pick<typeof db, "insert">;

export interface HistoryOptions {
  /**
   * Run the insert on this client instead of `db` — pass the transaction so the
   * audit row commits or rolls back atomically with the mutation it describes.
   */
  tx?: HistoryClient;
  source: ChangeSource;
}

export async function recordCreation(
  entityType: string,
  entityId: number,
  changedBy: number,
  { tx, source }: HistoryOptions,
) {
  await (tx ?? db).insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "created",
    changedBy,
    source,
  });
}

export async function recordUpdate(
  entityType: string,
  entityId: number,
  changedBy: number,
  changes: Record<string, { old: unknown; new: unknown }>,
  { tx, source }: HistoryOptions,
) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;

  await (tx ?? db).insert(changeHistory).values(
    entries.map(([fieldName, values]) => ({
      entityType,
      entityId,
      changeType: "updated" as const,
      fieldName,
      previousValue: JSON.stringify(values.old),
      newValue: JSON.stringify(values.new),
      changedBy,
      source,
    })),
  );
}

/**
 * Record a deletion with a previous-value snapshot so the audit trail can
 * reconstruct what was removed (the deleteBilledCost pattern).
 */
export async function recordDeletion(
  entityType: string,
  entityId: number,
  changedBy: number,
  previousValue: unknown,
  { tx, source }: HistoryOptions,
) {
  await (tx ?? db).insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "deleted",
    previousValue: JSON.stringify(previousValue),
    changedBy,
    source,
  });
}

export async function recordStatusChange(
  entityType: string,
  entityId: number,
  changedBy: number,
  previousStatus: string,
  newStatus: string,
  { tx, source }: HistoryOptions,
) {
  await (tx ?? db).insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "status_change",
    fieldName: "status",
    previousValue: JSON.stringify(previousStatus),
    newValue: JSON.stringify(newStatus),
    changedBy,
    source,
  });
}
