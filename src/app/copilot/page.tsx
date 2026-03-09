import { getCopilotOverview } from "@/actions/copilot-data";
import { OverviewCards } from "@/components/copilot/overview-cards";
import { UsageTrendChart } from "@/components/copilot/usage-trend-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Bot } from "lucide-react";
import Link from "next/link";

export default async function CopilotOverviewPage() {
  const result = await getCopilotOverview();

  if (!result.success) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  const data = result.data;
  const hasData = data.trends.length > 0 || data.totalSeats > 0;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Bot className="size-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">No Copilot data yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Enable Copilot sync in{" "}
            <Link href="/settings/integrations" className="underline text-primary">
              Settings &rarr; Integrations
            </Link>{" "}
            to start importing usage data, seat assignments, and billing information.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OverviewCards
        totalSeats={data.totalSeats}
        activeSeats={data.activeSeats}
        acceptanceRate={data.acceptanceRate}
        totalSuggestions={data.totalSuggestions}
        totalAcceptances={data.totalAcceptances}
      />
      <UsageTrendChart data={data.trends} />
    </div>
  );
}
