import { run } from "@/lib/sync/sources/anthropic-workspace";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
export const { GET, POST } = makeCronSyncRoute(run, "Anthropic API costs");
