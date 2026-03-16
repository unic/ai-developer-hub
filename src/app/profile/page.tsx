import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProfileData } from "@/actions/anthropic-usage";
import { db } from "@/lib/db";
import { anthropicUsageMetrics } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const userId = Number(session.user.id);
  const profileData = await getProfileData(userId);

  // Fetch available months for the month picker
  const monthRows = await db
    .selectDistinct({
      month: sql<string>`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM')`,
    })
    .from(anthropicUsageMetrics)
    .where(eq(anthropicUsageMetrics.userId, userId))
    .orderBy(
      sql`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM') DESC`
    );

  const availableMonths = monthRows.map((r) => r.month);

  // Ensure current month is always in the list
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!availableMonths.includes(currentMonth)) {
    availableMonths.unshift(currentMonth);
  }

  return <ProfileClient data={profileData} availableMonths={availableMonths} />;
}
