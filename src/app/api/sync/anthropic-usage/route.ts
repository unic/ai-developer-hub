import { run } from "@/lib/sync/sources/anthropic-usage";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
export const { GET, POST } = makeCronSyncRoute(run, "Anthropic usage");
