import Link from "next/link";
import { auth } from "@/lib/auth";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { getAssignments, getAssignmentsForUser } from "@/actions/assignments";
import { getActiveBudget } from "@/actions/budget";
import { formatCurrency } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Wrench,
  Users,
  KeyRound,
  DollarSign,
  BarChart3,
  AlertTriangle,
  Clock,
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  if (isAdmin) {
    return (
      <AuthGuard>
        <AdminDashboard />
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <ViewerDashboard userId={Number(session?.user?.id)} />
    </AuthGuard>
  );
}

async function AdminDashboard() {
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
        <h1 className="text-3xl font-bold retro:neon-glow-green">Dashboard</h1>
        <p className="text-muted-foreground retro:badge-retro">
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
            <Card className="transition-colors hover:bg-accent retro:border-glitch">
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

async function ViewerDashboard({ userId }: { userId: number }) {
  const assignments = await getAssignmentsForUser(userId);
  const myAssignments = assignments.filter(
    (a) => a.status === "active"
  );

  const myToolCount = new Set(myAssignments.map((a) => a.toolId)).size;
  const myTotalCost = myAssignments.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );

  // Recent assignment changes (last 5 for this user)
  const recentAssignments = assignments.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold retro:neon-glow-green">Dashboard</h1>
        <p className="text-muted-foreground retro:badge-retro">
          Your AI Tool Assignments
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">My Tools</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{myToolCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Licenses</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{myAssignments.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="size-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Total Monthly Cost
              </p>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {formatCurrency(myTotalCost)}
            </p>
          </CardContent>
        </Card>
      </div>

      {recentAssignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Assignments</CardTitle>
            <CardDescription>Your latest assignment activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentAssignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {a.tool.name} — {a.tier.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(a.costAtAssignmentCents)}/mo
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.assignedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
