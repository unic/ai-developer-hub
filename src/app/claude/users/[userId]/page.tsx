import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { format } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getUserDetail } from "@/actions/anthropic-users";
import { Badge } from "@/components/ui/badge";
import { UserDetailClient } from "./user-detail-client";

type PageProps = {
  params: Promise<{ userId: string }>;
};

function parseUserId(raw: string): number | null {
  // Reject obvious non-numeric / non-positive / non-integer inputs before
  // hitting the DB so `/claude/users/abc`, `/claude/users/0`, `/claude/users/-1`
  // all 404 cleanly.
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userId: raw } = await params;
  const userId = parseUserId(raw);
  if (userId === null) {
    return { title: "User · Claude Console" };
  }
  const detail = await getUserDetail(userId);
  if (!detail) return { title: "User · Claude Console" };
  const label = detail.user.name || detail.user.email;
  return { title: `${label} · Claude Console` };
}

export default async function ClaudeUserDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const { userId: raw } = await params;
  const userId = parseUserId(raw);
  if (userId === null) {
    notFound();
  }

  const currentMonth = format(new Date(), "yyyy-MM");
  const detail = await getUserDetail(userId, currentMonth);
  if (!detail) {
    notFound();
  }

  const profile = detail.user.profile;
  const workspace = detail.workspace;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link
          href="/claude/users"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <ChevronLeft className="size-3" /> Claude Console / Users
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {detail.user.name || detail.user.email}
        </h1>
        {detail.user.name && (
          <span className="text-sm text-muted-foreground">
            {detail.user.email}
          </span>
        )}
        {workspace.name && (
          <Badge variant="secondary" className="gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: workspace.displayColor ?? "#a1a1aa" }}
              aria-hidden
            />
            {workspace.name}
          </Badge>
        )}
        {profile && (
          <Badge variant="outline" className="capitalize">
            {profile}
          </Badge>
        )}
        {detail.user.status === "inactive" && (
          <Badge variant="secondary">Inactive</Badge>
        )}
      </div>

      <UserDetailClient userId={userId} initial={detail} />
    </div>
  );
}
