import { revalidatePath } from "next/cache";

import {
  COST_SURFACE_PATHS,
  assignmentCostPaths,
} from "@/lib/assignments/cost-paths";

/**
 * Replay the cost-surface path list through `revalidatePath` (spec 042).
 *
 * The list itself moved to `./cost-paths.ts` when 043 landed, so the write cores
 * can build a `CoreResult.revalidate` array from the same definition without
 * dragging `next/cache` into the MCP module graph. This file stays the transport
 * for Server Actions that do NOT go through a core — today that is only
 * `src/actions/license-requests.ts`.
 *
 * Only call this when a cost actually changed; see cost-paths.ts for why.
 *
 * Lives in a plain module because "use server" files may only export async
 * functions.
 */
export function revalidateCostSurfaces(): void {
  for (const path of COST_SURFACE_PATHS) revalidatePath(path);
}

/**
 * A single assignment's cost changed: the shared cost surfaces plus the two
 * pages scoped to this seat's user and tool.
 */
export function revalidateAssignmentCostPaths(
  userId: number,
  toolId: number,
): void {
  for (const path of assignmentCostPaths(userId, toolId)) revalidatePath(path);
}
