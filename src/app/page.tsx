import { auth } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import { AdminDashboard } from "@/components/dashboard/admin/admin-dashboard";
import { ViewerDashboard } from "@/components/dashboard/viewer/viewer-dashboard";

interface DashboardPageProps {
  searchParams: Promise<{ as?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const { as } = await searchParams;
  const previewAsViewer = isAdmin && as === "viewer";

  return (
    <AuthGuard>
      {isAdmin && !previewAsViewer ? (
        <AdminDashboard />
      ) : (
        <ViewerDashboard
          userId={Number(session?.user?.id)}
          isAdminPreview={previewAsViewer}
        />
      )}
    </AuthGuard>
  );
}
