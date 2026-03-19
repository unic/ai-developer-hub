import { getCopilotBilling, getCopilotBillingSyncHistory } from "@/actions/copilot-data";
import { BillingTrendChart } from "@/components/copilot/billing-trend-chart";
import { CostUtilizationChart } from "@/components/copilot/cost-utilization-chart";
import { BillingSyncButton } from "@/components/copilot/billing-sync-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { DollarSign } from "lucide-react";
import Link from "next/link";

function statusBadgeClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100";
    case "partial":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100";
    default:
      return "";
  }
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function CopilotBillingPage() {
  const [result, historyResult] = await Promise.all([
    getCopilotBilling(),
    getCopilotBillingSyncHistory(),
  ]);

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
  const syncHistory = historyResult.success ? historyResult.data : [];

  return (
    <div className="space-y-6">
      {/* Header with Sync Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Billing Overview</h2>
        <BillingSyncButton />
      </div>

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

      {/* Billing Details with Budget Context */}
      {data.trends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Monthly Billing Details</CardTitle>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Seats</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Cost / User</TableHead>
                    <TableHead>Budget Period</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trends.map((trend) => (
                    <TableRow key={trend.month}>
                      <TableCell className="text-sm">
                        {new Date(trend.month).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(trend.totalCostCents)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {trend.totalSeats}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {trend.activeSeats}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(trend.costPerActiveUserCents)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {trend.linkedPeriodLabel ? (
                          <span>
                            {trend.linkedPeriodLabel}
                            {trend.linkedPeriodUtilization !== null && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({trend.linkedPeriodUtilization}%)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {trend.linkStatus === "linked" && (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100">
                            Linked
                          </Badge>
                        )}
                        {trend.linkStatus === "unlinked" && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge
                                variant="secondary"
                                className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100"
                              >
                                Unlinked
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>No matching budget period</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {trend.linkStatus === "conflict" && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge
                                variant="destructive"
                                className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100"
                              >
                                Conflict
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>A manual cost entry already exists for this period</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}

      {/* Sync History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Sync History</CardTitle>
        </CardHeader>
        <CardContent>
          {syncHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync events recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Processed</TableHead>
                  <TableHead className="text-right">Linked</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncHistory.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm">
                      {formatTimestamp(event.startedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={statusBadgeClass(event.status)}
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {event.billingProcessed ?? "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {event.billingLinked ?? "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {event.billingSkipped ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {event.errorMessage
                        ? event.errorMessage.length > 60
                          ? `${event.errorMessage.slice(0, 60)}...`
                          : event.errorMessage
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
