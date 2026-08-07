import { run } from "@/lib/sync/sources/anthropic-workspace";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
// See the note in ../anthropic-usage/route.ts.
export const maxDuration = 300;
export const { GET, POST } = makeCronSyncRoute(run, "Anthropic API costs");
