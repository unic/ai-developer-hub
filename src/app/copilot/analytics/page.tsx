import { getCopilotAnalytics } from "@/actions/copilot-data";
import { LanguageChart } from "@/components/copilot/language-chart";
import { EditorChart } from "@/components/copilot/editor-chart";
import { ActivityDistribution } from "@/components/copilot/activity-distribution";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import Link from "next/link";

export default async function CopilotAnalyticsPage() {
  const result = await getCopilotAnalytics();

  if (!result.success) {
    return (
      <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{result.error}</p></CardContent></Card>
    );
  }

  const data = result.data;
  const hasData = data.byLanguage.length > 0 || data.byEditor.length > 0;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <BarChart3 className="size-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">No analytics data yet</h3>
          <p className="text-sm text-muted-foreground">Enable Copilot sync in <Link href="/settings/integrations" className="underline text-primary">Settings</Link> to start collecting usage analytics.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <LanguageChart data={data.byLanguage} />
        <EditorChart data={data.byEditor} />
      </div>
      <ActivityDistribution data={data.activityDistribution} />
    </div>
  );
}
