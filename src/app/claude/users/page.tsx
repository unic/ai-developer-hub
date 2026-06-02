import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getUserList,
  getUsersDashboardKpis,
  getAvailableUserMonths,
  getUserCostDistribution,
  getUserSparklines,
  getUserTopMovers,
  getDailyTotalsByUser,
} from "@/actions/anthropic-users";
import { getSyncStatus } from "@/actions/anthropic-global";
import { ClaudeTabs } from "@/components/claude/claude-tabs";
import { SyncButton } from "@/components/claude/sync-button";
import { SyncStatusPill } from "@/components/claude/sync-status-pill";
import { UsersMonthPicker } from "@/components/claude/users-month-picker";
import { UserKpiStrip } from "@/components/claude/user-kpi-strip";
import { TopUsersCard } from "@/components/claude/top-users-card";
import { CostDistributionHistogram } from "@/components/claude/cost-distribution-histogram";
import { DailyByUserChart } from "@/components/claude/daily-by-user-chart";
import { UsersTable } from "@/components/claude/users-table";
import { UserTopMoversChips } from "@/components/claude/user-top-movers-chips";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users as UsersIcon } from "lucide-react";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Claude Console · Users" };

// Mirrors the canonical month regex used by every server action that takes a
// `month?: string` parameter. Pages reuse it so an invalid URL param falls
// back to the current month cleanly instead of being silently passed through.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type SearchParamsPromise = Promise<Record<string, string | string[] | undefined>>;

export default async function ClaudeUsersPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const params = await searchParams;
  const rawMonth = typeof params.month === "string" ? params.month : undefined;
  const currentMonth = format(new Date(), "yyyy-MM");
  const selectedMonth =
    rawMonth && MONTH_PATTERN.test(rawMonth) ? rawMonth : currentMonth;

  const [
    kpis,
    list,
    distribution,
    sparklines,
    movers,
    daily,
    syncStatus,
    availableMonths,
  ] = await Promise.all([
    getUsersDashboardKpis(selectedMonth),
    getUserList(selectedMonth),
    getUserCostDistribution(selectedMonth),
    getUserSparklines(),
    getUserTopMovers(),
    getDailyTotalsByUser(selectedMonth),
    getSyncStatus(),
    getAvailableUserMonths(),
  ]);

  // No data at all → friendly empty state. Mirrors `/claude`'s EmptyState
  // pattern, with user-level copy.
  if (availableMonths.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Claude API Spending
            </h1>
            <p className="text-muted-foreground">
              Per-user breakdown of Anthropic usage and cost.
            </p>
          </div>
          <SyncButton />
        </div>
        <ClaudeTabs />
        <UsersEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Claude API Spending
          </h1>
          <p className="text-muted-foreground">
            Per-user breakdown of Anthropic usage and cost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UsersMonthPicker value={selectedMonth} months={availableMonths} />
          <SyncStatusPill status={syncStatus} />
          <SyncButton />
        </div>
      </div>

      <ClaudeTabs />

      <UserKpiStrip kpis={kpis} />

      {/* Phase 2: Daily-by-user stacked chart sits directly below the KPI strip;
          Top 10 moves below it. */}
      <DailyByUserChart data={daily} />

      <TopUsersCard users={list.users} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostDistributionHistogram buckets={distribution} />
        <UserTopMoversChips movers={movers} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={list.users} sparklines={sparklines} />
        </CardContent>
      </Card>
    </div>
  );
}

function UsersEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <UsersIcon className="mb-4 size-12 text-muted-foreground" />
      <h2 className="mb-2 text-xl font-semibold">No user-level data yet</h2>
      <p className="mb-6 max-w-sm text-center text-muted-foreground">
        User-level data will appear after the first sync. You can trigger a
        sync manually.
      </p>
      <SyncButton />
    </div>
  );
}
