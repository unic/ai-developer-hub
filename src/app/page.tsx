import { auth } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import { AdminDashboard } from "@/components/dashboard/admin/admin-dashboard";
import { ViewerDashboard } from "@/components/dashboard/viewer/viewer-dashboard";

export default async function DashboardPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  return (
    <AuthGuard>
      {isAdmin ? (
        <AdminDashboard />
      ) : (
        <ViewerDashboard userId={Number(session?.user?.id)} />
      )}
    </AuthGuard>
  );
}
