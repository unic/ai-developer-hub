import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import {
  getAssignmentById,
  getAssignmentComments,
} from "@/actions/assignments";
import { maskApiKey, decryptApiKey } from "@/lib/crypto";
import { AssignmentDetailClient } from "./assignment-detail-client";

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const assignmentId = Number(id);
  if (isNaN(assignmentId)) notFound();

  const session = await auth();
  if (!session?.user) notFound();

  const isAdmin = session.user.role === "admin";

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment) notFound();

  const comments = await getAssignmentComments(assignmentId);

  // Compute masked API key server-side
  let maskedApiKey: string | null = null;
  const hasApiKey = !!assignment.apiKeyEncrypted;
  if (hasApiKey && assignment.apiKeyEncrypted) {
    try {
      const plaintext = await decryptApiKey(assignment.apiKeyEncrypted);
      maskedApiKey = maskApiKey(plaintext);
    } catch {
      maskedApiKey = "••••••••";
    }
  }

  return (
    <AuthGuard>
      <AssignmentDetailClient
        assignment={{
          id: assignment.id,
          status: assignment.status,
          costAtAssignmentCents: assignment.costAtAssignmentCents,
          assignedAt: assignment.assignedAt?.toISOString() ?? null,
          revokedAt: assignment.revokedAt?.toISOString() ?? null,
          workspace: assignment.workspace,
          user: {
            id: assignment.user.id,
            name: assignment.user.name,
            discipline: assignment.user.discipline,
          },
          tool: { id: assignment.tool.id, name: assignment.tool.name },
          tier: { id: assignment.tier.id, name: assignment.tier.name },
          hasApiKey,
          maskedApiKey,
        }}
        comments={comments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          author: { name: c.author.name },
        }))}
        isAdmin={isAdmin}
      />
    </AuthGuard>
  );
}
