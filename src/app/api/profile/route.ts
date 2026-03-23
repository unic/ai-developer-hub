import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireBearerSecret } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  fetchProfileDataInternal,
  fetchUserCostDataInternal,
} from "@/actions/anthropic-usage";

export const dynamic = "force-dynamic";

const emailSchema = z.string().email("Invalid email format");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month format. Expected YYYY-MM.");

export async function GET(request: NextRequest) {
  // 1. Auth: Bearer token against PROFILE_API_SECRET
  const authError = requireBearerSecret(request, "PROFILE_API_SECRET");
  if (authError) return authError;

  // 2. Parse query parameters
  const { searchParams } = request.nextUrl;
  const emailParam = searchParams.get("email");
  const monthParam = searchParams.get("month");

  // 3. Validate email
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

  // 4. Validate optional month parameter
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
    // 5. Look up user by email
    const user = await db.query.users.findFirst({
      where: eq(users.email, emailParam),
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    // 6. Assemble profile data
    const profileData = await fetchProfileDataInternal(user.id, monthParam ?? undefined);

    // Determine the month used for cost data
    const now = new Date();
    const month =
      monthParam ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    // 7. Return response (exclude internal user.id per contract)
    return NextResponse.json({
      success: true,
      data: {
        user: {
          name: profileData.user.name,
          email: profileData.user.email,
          role: profileData.user.role,
          circle: profileData.user.circle,
          profile: profileData.user.profile,
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
