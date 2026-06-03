// POST /api/license-requests/ingest — spec 032-automation-workflow Phase 2.
//
// Bearer-secret-protected ingest endpoint that Power Automate calls when a
// Microsoft Form is submitted. Idempotent on formResponseId.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { licenseRequests, aiTools, accessTiers, users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireBearerSecret } from "@/lib/auth-helpers";
import { licenseRequestIngestSchema } from "@/lib/validators";
import { logIngestion } from "@/lib/ingestion-logger";
import { postLicenseRequestCard } from "@/lib/teams/graph";

export const dynamic = "force-dynamic";

// 64 KB sanity cap — protects against runaway MS Forms misconfiguration
// filling the table. Matches the figure in proposals.html.
const MAX_BODY_BYTES = 64 * 1024;

function hubBaseUrl(): string {
  // NextAuth's AUTH_URL is the canonical "where the app lives" var in this codebase.
  return (
    process.env.AUTH_URL?.replace(/\/$/, "") ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

export async function POST(request: NextRequest) {
  const authError = requireBearerSecret(
    request,
    "LICENSE_REQUEST_INGEST_SECRET",
  );
  if (authError) return authError;

  // Body size cap — pre-read on Content-Length, post-read fallback.
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const len = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Body exceeds 64 KB limit" },
        { status: 413 },
      );
    }
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Body exceeds 64 KB limit" },
        { status: 413 },
      );
    }
    payload = JSON.parse(text);
  } catch {
    await logIngestion({
      sourceType: "ms_forms_license_request",
      outcome: "failed",
      channel: "api",
      errorMessage: "Invalid JSON body",
      details: { kind: "license_request", deduped: false },
    });
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = licenseRequestIngestSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const error = issue
      ? `${issue.path.join(".")}: ${issue.message}`
      : "Invalid payload";
    await logIngestion({
      sourceType: "ms_forms_license_request",
      outcome: "failed",
      channel: "api",
      errorMessage: error,
      details: { kind: "license_request", deduped: false },
    });
    return NextResponse.json({ success: false, error }, { status: 400 });
  }

  const input = parsed.data;

  // Resolve tool — by ID if provided, else by case-insensitive name.
  let toolId: number;
  let toolName: string;
  if (input.toolId !== undefined) {
    const tool = await db.query.aiTools.findFirst({
      where: eq(aiTools.id, input.toolId),
      columns: { id: true, name: true },
    });
    if (!tool) {
      return jsonError(
        `Tool not found (id=${input.toolId})`,
        422,
        input.formResponseId,
      );
    }
    toolId = tool.id;
    toolName = tool.name;
  } else if (input.toolName) {
    const tool = await db
      .select({ id: aiTools.id, name: aiTools.name })
      .from(aiTools)
      .where(sql`lower(${aiTools.name}) = lower(${input.toolName})`)
      .limit(1);
    if (tool.length === 0) {
      return jsonError(
        `Tool not found (name="${input.toolName}")`,
        422,
        input.formResponseId,
      );
    }
    toolId = tool[0].id;
    toolName = tool[0].name;
  } else {
    // Refine guard already enforces this — defensive
    return jsonError(
      "toolId or toolName is required",
      400,
      input.formResponseId,
    );
  }

  // Resolve tier (optional).
  let tierId: number | null = null;
  let tierName: string | null = null;
  if (input.tierId !== undefined) {
    const tier = await db.query.accessTiers.findFirst({
      where: eq(accessTiers.id, input.tierId),
      columns: { id: true, name: true, toolId: true },
    });
    if (!tier || tier.toolId !== toolId) {
      return jsonError(
        `Tier not found for tool (tierId=${input.tierId})`,
        422,
        input.formResponseId,
      );
    }
    tierId = tier.id;
    tierName = tier.name;
  } else if (input.tierName) {
    const tier = await db
      .select({ id: accessTiers.id, name: accessTiers.name })
      .from(accessTiers)
      .where(
        sql`lower(${accessTiers.name}) = lower(${input.tierName}) and ${accessTiers.toolId} = ${toolId}`,
      )
      .limit(1);
    if (tier.length > 0) {
      tierId = tier[0].id;
      tierName = tier[0].name;
    }
    // If not found, leave nullable — admin can pick at approve time
  }

  // Optional requester match by email.
  const matchedUser = await db.query.users.findFirst({
    where: eq(users.email, input.requesterEmail.toLowerCase()),
    columns: { id: true },
  });

  // Idempotency — formResponseId is unique. Try insert; if conflict, return existing.
  let requestId: number;
  let deduped = false;
  try {
    const [row] = await db
      .insert(licenseRequests)
      .values({
        formResponseId: input.formResponseId,
        requesterEmail: input.requesterEmail.toLowerCase(),
        requesterName: input.requesterName,
        requesterUserId: matchedUser?.id ?? null,
        requestedToolId: toolId,
        requestedTierId: tierId,
        formPayload: input.formPayload,
        teamsTeamId: input.teamsTeamId,
        teamsChannelId: input.teamsChannelId,
        teamsParentMessageId: input.teamsParentMessageId,
        teamsChatId: input.teamsChatId,
      })
      .returning({ id: licenseRequests.id });
    requestId = row.id;
  } catch (err) {
    // Most likely unique violation on form_response_id — look up the existing row.
    const existing = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.formResponseId, input.formResponseId),
      columns: { id: true },
    });
    if (!existing) {
      console.error("license-requests ingest insert error:", err);
      await logIngestion({
        sourceType: "ms_forms_license_request",
        outcome: "failed",
        channel: "api",
        errorMessage: "Database insert failed",
        details: {
          kind: "license_request",
          formResponseId: input.formResponseId,
          requesterEmail: input.requesterEmail,
          requesterName: input.requesterName,
          deduped: false,
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: "An unexpected error occurred. Please try again.",
        },
        { status: 500 },
      );
    }
    requestId = existing.id;
    deduped = true;
  }

  const hubUrl = `${hubBaseUrl()}/requests/${requestId}`;

  // Fire-and-forget Graph card post. We don't await this for the response —
  // the request row is the source of truth; the Teams reply is a nice-to-have.
  // When Graph isn't configured, postLicenseRequestCard logs and returns.
  if (!deduped) {
    void postLicenseRequestCard({
      teamId: input.teamsTeamId,
      channelId: input.teamsChannelId,
      parentMessageId: input.teamsParentMessageId,
      requestId,
      requesterName: input.requesterName,
      toolName,
      tierName,
      hubUrl,
    }).catch((err) => {
      console.error("[license-requests] Graph card post failed:", err);
    });
  }

  // 034: a dedup replay is a successful, idempotent outcome — recorded as
  // `success` with details.deduped, not the invoice-only "filtered" outcome.
  await logIngestion({
    sourceType: "ms_forms_license_request",
    outcome: "success",
    channel: "api",
    entity: { type: "license_request", id: requestId },
    details: {
      kind: "license_request",
      formResponseId: input.formResponseId,
      requesterEmail: input.requesterEmail,
      requesterName: input.requesterName,
      toolName,
      tierName,
      deduped,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: { requestId, hubUrl, deduped },
    },
    { status: deduped ? 200 : 201 },
  );
}

function jsonError(error: string, status: number, formResponseId?: string) {
  // Fire-and-forget log — don't block the response on logger failures.
  void logIngestion({
    sourceType: "ms_forms_license_request",
    outcome: "failed",
    channel: "api",
    errorMessage: error,
    details: {
      kind: "license_request",
      formResponseId: formResponseId ?? null,
      deduped: false,
    },
  }).catch(() => undefined);
  return NextResponse.json({ success: false, error }, { status });
}
