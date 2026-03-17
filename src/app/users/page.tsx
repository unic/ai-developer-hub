import Link from "next/link";
import { getUsers } from "@/actions/users";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Download } from "lucide-react";
import { UsersTable } from "./users-table";
import { AuthGuard } from "@/components/auth-guard";

export default async function UsersPage() {
  const session = await auth();
  const userList = await getUsers();
  const isAdmin = session?.user.role === "admin";
  const pendingCount = userList.filter((u) => u.mustChangePassword).length;

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Users</h1>
              {pendingCount > 0 && (
                <Badge variant="secondary">
                  {pendingCount} user{pendingCount !== 1 ? "s" : ""} pending setup
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">Manage company user directory</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <a href="/api/export/users" download>
                  <Download className="mr-2 size-4" />
                  Export CSV
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link href="/users/import">Bulk Import</Link>
              </Button>
              <Button asChild>
                <Link href="/users/new">
                  <Plus className="mr-2 size-4" />
                  Add User
                </Link>
              </Button>
            </div>
          )}
        </div>
        <UsersTable data={userList} isAdmin={isAdmin} />
      </div>
    </AuthGuard>
  );
}
