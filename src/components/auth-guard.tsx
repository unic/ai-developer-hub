import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export async function AuthGuard({
  requiredRole,
  children,
}: {
  requiredRole?: "admin";
  children: React.ReactNode;
}) {
  const session = await auth();
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "/";
  const callbackUrl = encodeURIComponent(pathname);

  if (!session) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center">
              <Lock className="size-10 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl">Authentication Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You must be signed in to view this page.
            </p>
            <Button asChild>
              <Link href={`/login?callbackUrl=${callbackUrl}`}>Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
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
