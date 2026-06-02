import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { CopilotFreshness } from "@/actions/copilot-data";

export function MetricsFreshnessCard({ freshness }: { freshness: CopilotFreshness }) {
  if (!freshness.stale || freshness.daysBehind == null) return null;

  return (
    <Card className="border-warning">
      <CardContent className="flex items-start gap-3 py-4">
        <AlertTriangle className="size-5 mt-0.5 text-warning shrink-0" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            Copilot metrics are stale — last data {freshness.daysBehind} days ago
            {freshness.latestDate ? ` (${freshness.latestDate})` : ""}.
          </p>
          <p className="text-muted-foreground">
            GitHub finalizes Copilot usage data within ~3 days, so a 3–4 day lag
            is normal. Anything beyond that usually means the sync is failing or
            the token is missing the <code className="rounded bg-muted px-1 py-0.5 text-xs">read:org</code> scope.
            Check the{" "}
            <Link
              href="/settings/integrations"
              className="underline text-primary"
            >
              integration status
            </Link>
            {" "}or run a backfill.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
