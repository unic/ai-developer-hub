import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireBearerSecret } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { mintAgentJwt } from "@/lib/agent-auth";
import { logAgentRequest } from "@/lib/agent-log";
import type { UserPreferences } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PREFERENCES: UserPreferences = { theme: "system" };
const AGENT_SESSION_TTL_SECONDS = 30 * 60;

export async function POST(request: NextRequest) {
  const authError = requireBearerSecret(request, "AGENT_SESSION_SECRET");
  if (authError) {
    logAgentRequest({
      pathname: "/api/agent/session",
      method: "POST",
      decision: "auth-failure",
      status: 401,
      reason: "missing or wrong bearer",
    });
    return authError;
  }

  if (process.env.VERCEL_ENV === "production") {
    logAgentRequest({
      pathname: "/api/agent/session",
      method: "POST",
      decision: "production-refused",
      status: 403,
      reason: "production refused",
    });
    return NextResponse.json(
      {
        success: false,
        error: "Agent sessions are not available on production",
      },
      { status: 403 }
    );
  }

  const agentEmail = (process.env.AGENT_USER_EMAIL ?? "nighthawk@agent.local").toLowerCase();

  const agent = await db.query.users.findFirst({
    where: and(eq(users.email, agentEmail), eq(users.isAgent, true)),
  });

  if (!agent || agent.status !== "active") {
    logAgentRequest({
      pathname: "/api/agent/session",
      method: "POST",
      decision: "no-agent-user",
      status: 503,
      reason: "agent user not provisioned",
    });
    return NextResponse.json(
      { success: false, error: "Agent user not provisioned" },
      { status: 503 }
    );
  }

  const { cookieName, token, maxAgeSeconds } = await mintAgentJwt(
    {
      id: String(agent.id),
      email: agent.email,
      name: agent.name,
      role: agent.role,
      preferences: agent.preferences ?? DEFAULT_PREFERENCES,
      isAgent: true,
    },
    { maxAgeSeconds: AGENT_SESSION_TTL_SECONDS }
  );

  logAgentRequest({
    pathname: "/api/agent/session",
    method: "POST",
    decision: "allow",
    status: 200,
    userId: String(agent.id),
  });

  const response = NextResponse.json({
    success: true,
    cookieName,
    expiresIn: maxAgeSeconds,
  });
  response.cookies.set({
    name: cookieName,
    value: token,
    httpOnly: true,
    secure: cookieName.startsWith("__Secure-"),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return response;
}
