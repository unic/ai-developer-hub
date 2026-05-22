import { AuthGuard } from "@/components/auth-guard";
import { listLicenseRequests } from "@/actions/license-requests";
import { RequestsTable } from "./requests-table";

export default async function RequestsPage() {
  const requests = await listLicenseRequests();

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">License requests</h1>
          <p className="text-muted-foreground">
            Review and action license requests routed from Microsoft Forms via Power Automate.
            Any admin can claim any request — first to act wins.
          </p>
        </div>
        <RequestsTable data={requests} />
      </div>
    </AuthGuard>
  );
}
