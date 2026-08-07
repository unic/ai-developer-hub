/**
 * The pages whose figures are derived from assignment cost (spec 042).
 *
 * Every spend aggregation sums license_assignments.cost_at_assignment_cents, so
 * a cost change makes all of these stale at once. This is the single LIST —
 * both the assignment-level tier change and the tier price cascade build from
 * it, rather than keeping their own copies, which is what let the two drift
 * apart in the first place.
 *
 * Only invalidate these when a cost actually changed. Each entry forces the next
 * visitor to recompute that page (the dashboard alone runs ~13 queries), so
 * busting them on a workspace or API-key edit is pure waste.
 *
 * This module is the LIST only; there are two TRANSPORTS that replay it:
 *   - `src/lib/assignments/revalidate.ts` calls `revalidatePath` directly, for
 *     Server Actions that do not go through a write core (today only
 *     `src/actions/license-requests.ts`);
 *   - `CoreResult.revalidate` (src/lib/core/context.ts), for everything that
 *     does — the Server Action wrapper replays it through `revalidatePath`, the
 *     MCP adapter through `revalidateQuietly`.
 * A given write uses exactly one of them, never both.
 *
 * Deliberately imports nothing from `next/cache`: `src/lib/core/*` is loaded by
 * the MCP route and by db-mocked unit tests, and spec 043 keeps `next/cache` out
 * of that module graph (see the dynamic import in src/lib/mcp/write.ts).
 */
export const COST_SURFACE_PATHS = [
  "/",
  "/assignments",
  "/budget",
  "/reports",
  "/reports/budget",
] as const;

/**
 * A single assignment's cost changed: the shared cost surfaces plus the two
 * pages scoped to this seat's user and tool.
 */
export function assignmentCostPaths(userId: number, toolId: number): string[] {
  return [...COST_SURFACE_PATHS, `/users/${userId}`, `/tools/${toolId}`];
}
