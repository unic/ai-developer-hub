import Link from "next/link";
import { getTools, getActiveAssignmentCountForTool } from "@/actions/tools";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { ToolsTable } from "./tools-table";
import { AuthGuard } from "@/components/auth-guard";

export default async function ToolsPage() {
  const session = await auth();
  const tools = await getTools();
  const isAdmin = session?.user.role === "admin";

  const toolsWithCounts = await Promise.all(
    tools.map(async (tool) => ({
      ...tool,
      activeLicenses: await getActiveAssignmentCountForTool(tool.id),
    }))
  );

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">AI Tools</h1>
            <p className="text-muted-foreground">Manage your AI tool registry</p>
          </div>
          {isAdmin && (
            <Button asChild>
              <Link href="/tools/new">
                <Plus className="mr-2 size-4" />
                Add Tool
              </Link>
            </Button>
          )}
        </div>
        <ToolsTable data={toolsWithCounts} isAdmin={isAdmin} />
      </div>
    </AuthGuard>
  );
}
