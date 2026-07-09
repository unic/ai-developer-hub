import { notFound } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { auth } from "@/lib/auth";
import { getRequestContext } from "@/actions/license-requests";
import { listApprovalTemplates } from "@/lib/license-requests/templates";
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

  // Current admin's identity — passed to the approve dialog so
  // {{approver.firstName}} / {{approver.name}} template variables resolve.
  const session = await auth();
  const adminName = session?.user?.name ?? "Admin";
  const adminFirstName = adminName.split(/\s+/)[0] ?? adminName;

  // All approval templates — the admin can switch the tool in the dialog
  // (override / indie pick), so the client resolves per selection.
  const approvalTemplates = await listApprovalTemplates();

  return (
    <AuthGuard requiredRole="admin">
      <RequestDetailClient
        detail={ctx.detail}
        tools={ctx.tools}
        activeAssignments={ctx.activeAssignments}
        approvalTemplates={approvalTemplates}
        approver={{ name: adminName, firstName: adminFirstName }}
      />
    </AuthGuard>
  );
}
