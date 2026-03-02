import Link from "next/link";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { getAssignments } from "@/actions/assignments";
import { getActiveBudget } from "@/actions/budget";
import { formatCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  Users,
  KeyRound,
  DollarSign,
  BarChart3,
  AlertTriangle,
} from "lucide-react";

export default async function DashboardPage() {
  const [tools, userList, assignments, activeBudget] = await Promise.all([
    getTools(),
    getUsers(),
    getAssignments(),
    getActiveBudget(),
  ]);

  const activeUsers = userList.filter((u) => u.status === "active").length;
  const activeTools = tools.filter((t) => t.status === "active").length;
  const activeAssignments = assignments.filter(
    (a) => a.status === "active"
  );
  const totalMonthlySpend = activeAssignments.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );

  const budgetUtilization = activeBudget
    ? Math.round(
        ((totalMonthlySpend * 12) / activeBudget.totalAmountCents) * 100
      )
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          AI Tool Access & Budget Overview
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Users</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{activeUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Tools</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{activeTools}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Licenses</p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {activeAssignments.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Monthly Spend</p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {formatCurrency(totalMonthlySpend)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                YTD Budget Util.
              </p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {activeBudget ? `${budgetUtilization}%` : "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>

      {budgetUtilization > 90 && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="size-5 text-destructive" />
            <p className="text-sm">
              Budget utilization is at {budgetUtilization}% — approaching annual
              limit.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: "AI Tools",
            description: "Manage tool registry and access tiers",
            href: "/tools",
            icon: Wrench,
          },
          {
            title: "Users",
            description: "Manage company user directory",
            href: "/users",
            icon: Users,
          },
          {
            title: "Assignments",
            description: "Track license assignments",
            href: "/assignments",
            icon: KeyRound,
          },
          {
            title: "Budget",
            description: "Plan and track annual budget",
            href: "/budget",
            icon: DollarSign,
          },
        ].map((card) => (
          <Link key={card.href} href={card.href}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <card.icon className="size-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{card.title}</CardTitle>
                </div>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
