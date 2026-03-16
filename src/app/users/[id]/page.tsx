import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getUserById, getUserAssignments } from "@/actions/users";
import { getEntityHistory } from "@/actions/history";
import { getGitHubProfile } from "@/actions/github";
import { getUserCostData } from "@/actions/anthropic-usage";
import { db } from "@/lib/db";
import { anthropicUsageMetrics } from "@/lib/db/schema";
import { UserDetailClient } from "./user-detail-client";
import { AuthGuard } from "@/components/auth-guard";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = Number(id);
  if (isNaN(userId)) notFound();

  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const user = await getUserById(userId);
  if (!user) notFound();

  const [assignments, historyResult, ghResult] = await Promise.all([
    getUserAssignments(userId),
    getEntityHistory("user", userId),
    getGitHubProfile(userId),
  ]);
  const history = historyResult.success ? historyResult.data.records : [];
  const githubProfile = ghResult.success ? ghResult.data.profile : null;

  // Fetch Claude API cost data
  const costData = await getUserCostData(Number(params.id));

  // Fetch available months for this user
  const costMonthRows = await db
    .selectDistinct({
      month: sql<string>`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM')`,
    })
    .from(anthropicUsageMetrics)
    .where(eq(anthropicUsageMetrics.userId, Number(params.id)))
    .orderBy(sql`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM') DESC`);

  const costAvailableMonths = costMonthRows.map((r) => r.month);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!costAvailableMonths.includes(currentMonth)) {
    costAvailableMonths.unshift(currentMonth);
  }

  return (
    <AuthGuard requiredRole="admin">
      <UserDetailClient
        user={user}
        assignments={assignments}
        history={history}
        isAdmin={isAdmin}
        githubProfile={githubProfile}
        costData={costData}
        costAvailableMonths={costAvailableMonths}
      />
    </AuthGuard>
  );
}
