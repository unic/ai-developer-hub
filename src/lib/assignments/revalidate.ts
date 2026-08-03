import { revalidatePath } from "next/cache";

/**
 * Revalidate every surface that shows an assignment's cost (spec 042).
 *
 * Any change to tier_id / cost_at_assignment_cents moves per-period expected
 * spend, so the budget and report pages are as stale as the assignment pages.
 * updateAssignment previously revalidated only /assignments, /users/[id] and
 * /reports — leaving the budget health figures serving pre-change numbers.
 * Mirrors what the analogous tier price cascade in actions/tools.ts revalidates.
 *
 * Lives in a plain module because "use server" files may only export async
 * functions.
 */
export function revalidateAssignmentCostPaths(
  userId: number,
  toolId: number,
): void {
  revalidatePath("/assignments");
  revalidatePath(`/users/${userId}`);
  revalidatePath(`/tools/${toolId}`);
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  revalidatePath("/budget");
  revalidatePath("/");
}
