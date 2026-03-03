import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getToolWithTiers,
  getActiveAssignmentCountForTool,
  getActiveAssignmentCountForTier,
} from "@/actions/tools";
import { getEntityHistory } from "@/actions/history";
import { ToolDetailClient } from "./tool-detail-client";
import { AuthGuard } from "@/components/auth-guard";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const toolId = Number(id);
  if (isNaN(toolId)) notFound();

  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const tool = await getToolWithTiers(toolId);
  if (!tool) notFound();

  const activeAssignments = await getActiveAssignmentCountForTool(toolId);

  const tierCounts = await Promise.all(
    tool.accessTiers.map(async (tier) => ({
      tierId: tier.id,
      count: await getActiveAssignmentCountForTier(tier.id),
    }))
  );

  const historyResult = await getEntityHistory("ai_tool", toolId);
  const history =
    historyResult.success ? historyResult.data.records : [];

  return (
    <AuthGuard requiredRole="admin">
      <ToolDetailClient
        tool={tool}
        tiers={tool.accessTiers}
        activeAssignments={activeAssignments}
        tierAssignmentCounts={tierCounts}
        history={history}
        isAdmin={isAdmin}
      />
    </AuthGuard>
  );
}
