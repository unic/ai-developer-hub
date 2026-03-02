import { auth } from "@/lib/auth";
import { getAssignments } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { AssignmentsClient } from "./assignments-client";

export default async function AssignmentsPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const [assignments, tools, userList] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
  ]);

  const activeTools = tools.filter((t) => t.status === "active");
  const activeUsers = userList.filter((u) => u.status === "active");

  return (
    <AssignmentsClient
      assignments={assignments}
      tools={activeTools}
      users={activeUsers}
      isAdmin={isAdmin}
    />
  );
}
