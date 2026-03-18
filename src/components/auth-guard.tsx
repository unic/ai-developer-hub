import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function AuthGuard({
  requiredRole,
  children,
}: {
  requiredRole?: "admin";
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    const headerStore = await headers();
    const pathname = headerStore.get("x-pathname") ?? "/";
    const callbackUrl = encodeURIComponent(pathname);
    redirect(`/login?callbackUrl=${callbackUrl}`);
  }

  if (requiredRole === "admin" && session.user?.role !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center">
              <Lock className="size-10 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You do not have permission to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
