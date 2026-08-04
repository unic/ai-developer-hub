import { run } from "@/lib/sync/sources/github-copilot";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
// See the note in ../anthropic-usage/route.ts.
export const maxDuration = 300;
export const { GET, POST } = makeCronSyncRoute(run, "GitHub Copilot");
