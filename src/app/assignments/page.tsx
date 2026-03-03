import { auth } from "@/lib/auth";
import { getAssignments } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { AssignmentsClient } from "./assignments-client";
import { AuthGuard } from "@/components/auth-guard";

export default async function AssignmentsPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const [allAssignments, tools, userList] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
  ]);

  // Viewers see only their own assignments
  const assignments = isAdmin
    ? allAssignments
    : allAssignments.filter(
        (a) => a.userId === Number(session?.user?.id)
      );

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
