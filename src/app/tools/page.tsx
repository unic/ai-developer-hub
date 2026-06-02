import Link from "next/link";
import { getTools, getActiveAssignmentCountForTool } from "@/actions/tools";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ToolsTable } from "./tools-table";
import { AuthGuard } from "@/components/auth-guard";

export default async function ToolsPage() {
  const session = await auth();
  const tools = await getTools();
  const isAdmin = session?.user.role === "admin";

  // Viewers don't see the license count column, so don't run the N queries.
  const toolsWithCounts = isAdmin
    ? await Promise.all(
        tools.map(async (tool) => ({
          ...tool,
          activeLicenses: await getActiveAssignmentCountForTool(tool.id),
        }))
      )
    : tools.map((tool) => ({ ...tool, activeLicenses: 0 }));

  return (
    <AuthGuard>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-medium tracking-tight text-ink">AI Tools</h1>
            <p className="text-muted-foreground">
              {isAdmin
                ? "Manage your AI tool registry"
                : "Browse the AI tools available in your organisation"}
            </p>
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
