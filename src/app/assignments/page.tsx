import { auth } from "@/lib/auth";
import { getAssignments, getAssignmentsForUser } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { AssignmentsClient } from "./assignments-client";
import { AuthGuard } from "@/components/auth-guard";

export default async function AssignmentsPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  // Viewers only need their own assignments; admins need everything
  const [assignments, tools, userList] = isAdmin
    ? await Promise.all([getAssignments(), getTools(), getUsers()])
    : [await getAssignmentsForUser(Number(session?.user?.id)), [], []];

  const activeTools = tools.filter((t) => t.status === "active");
  const activeUsers = userList.filter((u) => u.status === "active");

  return (
    <AuthGuard>
      <AssignmentsClient
        assignments={assignments}
        tools={activeTools}
        users={activeUsers}
        isAdmin={isAdmin}
      />
    </AuthGuard>
  );
}
