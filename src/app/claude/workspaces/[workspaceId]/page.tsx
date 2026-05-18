import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { format } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getWorkspaceDetail } from "@/actions/anthropic-global";
import { Badge } from "@/components/ui/badge";
import { WorkspaceDetailClient } from "./workspace-detail-client";

type PageProps = {
  params: Promise<{ workspaceId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { workspaceId } = await params;
  return {
    title: `${workspaceId === "default" ? "Default workspace" : workspaceId} · Claude API Spending`,
  };
}

export default async function WorkspaceDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const { workspaceId } = await params;
  const currentMonth = format(new Date(), "yyyy-MM");
  const detail = await getWorkspaceDetail(workspaceId, currentMonth);
  if (!detail) {
    notFound();
  }

  const isOverBudget =
    detail.utilizationPct != null && detail.utilizationPct >= 100;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link
          href={`/claude?workspace=${workspaceId}`}
          className="inline-flex items-center gap-1 hover:underline"
        >
          <ChevronLeft className="size-3" /> Claude API Spending
        </Link>
      </nav>

      <div className="flex items-center gap-3">
        <span
          className="size-3 rounded-full"
          style={{
            backgroundColor: detail.workspace.displayColor ?? "#a1a1aa",
          }}
          aria-hidden
        />
        <h1 className="text-2xl font-bold tracking-tight">{detail.workspace.name}</h1>
        {detail.workspace.isDefault && (
          <Badge variant="secondary">Default</Badge>
        )}
        {isOverBudget && <Badge variant="destructive">Over budget</Badge>}
      </div>

      <WorkspaceDetailClient
        workspaceIdParam={workspaceId}
        initial={detail}
      />
    </div>
  );
}
