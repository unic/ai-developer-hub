import { run } from "@/lib/sync/sources/github-copilot";
import { makeCronSyncRoute } from "@/lib/sync/cron-handler";

export const dynamic = "force-dynamic";
export const { GET, POST } = makeCronSyncRoute(run, "GitHub Copilot");
