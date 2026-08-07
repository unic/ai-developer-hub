import { run } from "@/lib/sync/sources/anthropic-usage";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
// Bound the run explicitly rather than inheriting the platform default, so a
// stuck sync has a known kill point well under the 60-minute stale-event cutoff
// in src/lib/sync/framework.ts.
export const maxDuration = 300;
export const { GET, POST } = makeCronSyncRoute(run, "Anthropic usage");
