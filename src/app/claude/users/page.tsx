import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getUserList,
  getUsersDashboardKpis,
  getAvailableUserMonths,
} from "@/actions/anthropic-users";
import { ClaudeTabs } from "@/components/claude/claude-tabs";
import { SyncButton } from "@/components/claude/sync-button";
import { UserKpiStrip } from "@/components/claude/user-kpi-strip";
import { TopUsersBarChart } from "@/components/claude/top-users-bar-chart";
import { UsersTable } from "@/components/claude/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users as UsersIcon } from "lucide-react";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Claude Console · Users" };

export default async function ClaudeUsersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const currentMonth = format(new Date(), "yyyy-MM");
  const availableMonths = await getAvailableUserMonths();

  // No data at all → friendly empty state with a manual sync button. Mirrors
  // the EmptyState pattern on `/claude` (src/app/claude/page.tsx:123-135),
  // adapted for user-level copy.
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

  const [kpis, list] = await Promise.all([
    getUsersDashboardKpis(currentMonth),
    getUserList(currentMonth),
  ]);

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

      <UserKpiStrip kpis={kpis} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 Users by Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <TopUsersBarChart users={list.users} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={list.users} />
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
