import { revalidatePath } from "next/cache";

/**
 * The pages whose figures are derived from assignment cost (spec 042).
 *
 * Every spend aggregation sums license_assignments.cost_at_assignment_cents, so
 * a cost change makes all of these stale at once. This is the single list —
 * actions/tools.ts's tier price cascade calls it too, rather than keeping its own
 * copy, which is what let the two drift apart in the first place.
 *
 * Only call this when a cost actually changed. Each entry forces the next visitor
 * to recompute that page (the dashboard alone runs ~13 queries), so invalidating
 * on a workspace or API-key edit is pure waste.
 *
 * Lives in a plain module because "use server" files may only export async
 * functions.
 */
export function revalidateCostSurfaces(): void {
  revalidatePath("/");
  revalidatePath("/assignments");
  revalidatePath("/budget");
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
}

/**
 * A single assignment's cost changed: the shared cost surfaces plus the two
 * pages scoped to this seat's user and tool.
 */
export function revalidateAssignmentCostPaths(
  userId: number,
  toolId: number,
): void {
  revalidateCostSurfaces();
  revalidatePath(`/users/${userId}`);
  revalidatePath(`/tools/${toolId}`);
}
