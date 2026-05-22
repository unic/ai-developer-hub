import { notFound } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { getRequestContext } from "@/actions/license-requests";
import { findTemplate } from "@/lib/license-requests/templates";
import { RequestDetailClient } from "./request-detail-client";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const ctx = await getRequestContext(id);
  if (!ctx) notFound();

  // Pre-fetch the right templates so the action modals open with content
  // already loaded (vs. paying a roundtrip on every click).
  const [approvalTemplate, completionTemplate] = await Promise.all([
    findTemplate(ctx.detail.requestedToolId, ctx.detail.requestedTierId, "approval"),
    findTemplate(ctx.detail.requestedToolId, ctx.detail.requestedTierId, "completion"),
  ]);

  return (
    <AuthGuard requiredRole="admin">
      <RequestDetailClient
        detail={ctx.detail}
        tiers={ctx.tiers}
        approvalTemplate={approvalTemplate}
        completionTemplate={completionTemplate}
      />
    </AuthGuard>
  );
}
