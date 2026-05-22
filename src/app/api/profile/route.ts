import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireBearerSecret } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { users, anthropicSyncStatus } from "@/lib/db/schema";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import { getCurrentMonth } from "@/lib/utils";

export const dynamic = "force-dynamic";

const emailSchema = z.string().email("Invalid email format");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month format. Expected YYYY-MM.");

export async function GET(request: NextRequest) {
  const authError = requireBearerSecret(request, "PROFILE_API_SECRET");
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const emailParam = searchParams.get("email");
  const monthParam = searchParams.get("month");

  if (!emailParam) {
    return NextResponse.json(
      { success: false, error: "Missing required query parameter: email" },
      { status: 400 }
    );
  }

  const emailResult = emailSchema.safeParse(emailParam);
  if (!emailResult.success) {
    return NextResponse.json(
      { success: false, error: "Invalid email format" },
      { status: 400 }
    );
  }

  if (monthParam) {
    const monthResult = monthSchema.safeParse(monthParam);
    if (!monthResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid month format. Expected YYYY-MM." },
        { status: 400 }
      );
    }
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, emailParam),
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    const [profileData, syncRows] = await Promise.all([
      fetchProfileDataInternal(user.id, monthParam ?? undefined),
      db
        .select({ lastSyncCompletedAt: anthropicSyncStatus.lastSyncCompletedAt })
        .from(anthropicSyncStatus)
        .where(eq(anthropicSyncStatus.userId, user.id))
        .limit(1),
    ]);
    const syncStatus = syncRows[0] ?? null;
    const month = monthParam ?? getCurrentMonth();

    return NextResponse.json({
      success: true,
      data: {
        user: {
          name: profileData.user.name,
          email: profileData.user.email,
          role: profileData.user.role,
          circle: profileData.user.circle,
          profile: profileData.user.profile,
          discipline: profileData.user.discipline,
          status: user.status,
        },
        assignments: profileData.assignments.map((a) => ({
          id: a.id,
          toolName: a.toolName,
          tierName: a.tierName,
          assignedAt: a.assignedAt,
          status: a.status,
        })),
        costData: {
          ...profileData.costData,
          month,
          lastSyncAt: syncStatus?.lastSyncCompletedAt?.toISOString() ?? null,
        },
      },
    });
  } catch (err) {
    console.error("Profile API error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
