import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserById, getUserAssignments } from "@/actions/users";
import { getEntityHistory } from "@/actions/history";
import { getGitHubProfile } from "@/actions/github";
import { getUserCostData, getAvailableMonths } from "@/actions/anthropic-usage";
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

  const [assignments, historyResult, ghResult, costData, costAvailableMonths] = await Promise.all([
    getUserAssignments(userId),
    getEntityHistory("user", userId),
    getGitHubProfile(userId),
    getUserCostData(userId),
    getAvailableMonths(userId),
  ]);
  const history = historyResult.success ? historyResult.data.records : [];
  const githubProfile = ghResult.success ? ghResult.data.profile : null;

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
