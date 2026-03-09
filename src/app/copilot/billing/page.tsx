import { getCopilotBilling } from "@/actions/copilot-data";
import { BillingTrendChart } from "@/components/copilot/billing-trend-chart";
import { CostUtilizationChart } from "@/components/copilot/cost-utilization-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import Link from "next/link";

function formatCurrency(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function CopilotBillingPage() {
  const result = await getCopilotBilling();

  if (!result.success) {
    return (
      <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{result.error}</p></CardContent></Card>
    );
  }

  const data = result.data;
  if (!data.currentMonth) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <DollarSign className="size-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">No billing data yet</h3>
          <p className="text-sm text-muted-foreground">Enable Copilot sync in <Link href="/settings/integrations" className="underline text-primary">Settings</Link> to import billing data.</p>
        </CardContent>
      </Card>
    );
  }

  const { currentMonth } = data;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Month Cost</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(currentMonth.totalCostCents)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cumulative Cost</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(data.cumulativeCostCents)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost / Active User</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(currentMonth.costPerActiveUserCents)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Plan</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold capitalize">{currentMonth.planType}</div><p className="text-xs text-muted-foreground">{currentMonth.totalSeats} total / {currentMonth.activeSeats} active seats</p></CardContent>
        </Card>
      </div>

      <BillingTrendChart data={data.trends} />
      <CostUtilizationChart data={data.trends} />
    </div>
  );
}
