// Integration tests for POST /api/license-requests/ingest (032-v2) — the
// suites deferred since the v1 merge. Runs against the real Neon branch;
// invokes the route handler directly with NextRequest.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

// auth-helpers imports next-auth via @/lib/auth, whose ESM imports don't
// resolve under vitest. The route only uses requireBearerSecret (pure env +
// header check) — stub the next-auth side out; the bearer logic stays real.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
import { db } from "@/lib/db";
import {
  licenseRequests,
  ingestionLog,
  toolMappings,
  aiTools,
} from "@/lib/db/schema";
import { and, eq, inArray, like } from "drizzle-orm";

const SECRET = "test-license-ingest-secret";
process.env.LICENSE_REQUEST_INGEST_SECRET = SECRET;

import { POST } from "@/app/api/license-requests/ingest/route";

const RUN_TAG = `ingest-v2-${Date.now()}`;
const createdRequestIds: number[] = [];

function makeRequest(body: unknown, token: string | null = SECRET) {
  return new NextRequest("http://localhost:3000/api/license-requests/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    formResponseId: `${RUN_TAG}-${Math.random().toString(36).slice(2, 10)}`,
    requesterEmail: `${RUN_TAG}@test.local`,
    requesterName: "Ingest V2 Test",
    formPayload: { "Which role describes you?": "Development" },
    teamsTeamId: "team-1",
    teamsChannelId: "channel-1",
    teamsParentMessageId: "msg-1",
    teamsChatId: "chat-1",
    ...overrides,
  };
}

async function trackCreated(res: Response) {
  const json = (await res.clone().json()) as {
    data?: { requestId?: number };
  };
  if (json.data?.requestId) createdRequestIds.push(json.data.requestId);
  return json;
}

let developerBaselineToolId: number | null = null;

beforeAll(async () => {
  // The seeded mapping rows must exist for the v2 path — resolve what
  // (developer, baseline) maps to so assertions track live config.
  const rows = await db
    .select({ toolId: toolMappings.toolId })
    .from(toolMappings)
    .where(
      and(eq(toolMappings.profile, "baseline"), eq(toolMappings.role, "developer")),
    );
  developerBaselineToolId = rows[0]?.toolId ?? null;
});

afterAll(async () => {
  if (createdRequestIds.length > 0) {
    await db
      .delete(licenseRequests)
      .where(inArray(licenseRequests.id, createdRequestIds));
  }
  await db
    .delete(licenseRequests)
    .where(like(licenseRequests.formResponseId, `${RUN_TAG}%`));
  await db
    .delete(ingestionLog)
    .where(like(ingestionLog.invoiceNumber, `${RUN_TAG}%`))
    .catch(() => undefined);
});

describe("POST /api/license-requests/ingest — auth", () => {
  it("401s without a bearer token", async () => {
    const res = await POST(makeRequest(basePayload(), null));
    expect(res.status).toBe(401);
  });

  it("401s with a wrong bearer token", async () => {
    const res = await POST(makeRequest(basePayload(), "wrong-secret"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/license-requests/ingest — v2 contract", () => {
  it("derives the tool from (development, baseline) via the mapping", async () => {
    const res = await POST(
      makeRequest(basePayload({ role: "development", profile: "" })),
    );
    expect(res.status).toBe(201);
    const json = await trackCreated(res);
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, json.data!.requestId!),
    });
    expect(row?.requesterRole).toBe("developer");
    expect(row?.requesterProfile).toBe("baseline");
    expect(row?.requestedToolId).toBe(developerBaselineToolId);
  });

  it("indie resolves to needs-decision (null tool) and requires justification", async () => {
    const missing = await POST(
      makeRequest(basePayload({ role: "business", profile: "indie" })),
    );
    expect(missing.status).toBe(400);
    const missingJson = (await missing.json()) as { error: string };
    expect(missingJson.error).toContain("justification");

    const res = await POST(
      makeRequest(
        basePayload({
          role: "business",
          profile: "indie",
          justification: "Custom OpenCode setup needs direct API access",
        }),
      ),
    );
    expect(res.status).toBe(201);
    const json = await trackCreated(res);
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, json.data!.requestId!),
    });
    expect(row?.requestedToolId).toBeNull();
    expect(row?.requesterProfile).toBe("indie");
    expect(row?.justification).toContain("OpenCode");
  });

  it("rejects unknown role values with a 400 naming the field", async () => {
    const res = await POST(makeRequest(basePayload({ role: "wizard" })));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("role");
  });

  it("is idempotent on formResponseId (200 + deduped)", async () => {
    const payload = basePayload({ role: "development", profile: "" });
    const first = await POST(makeRequest(payload));
    expect(first.status).toBe(201);
    await trackCreated(first);

    const second = await POST(makeRequest(payload));
    expect(second.status).toBe(200);
    const json = (await second.json()) as { data: { deduped: boolean } };
    expect(json.data.deduped).toBe(true);
  });
});

describe("POST /api/license-requests/ingest — legacy v1 contract", () => {
  it("still accepts toolName when role is absent", async () => {
    const tool = await db.query.aiTools.findFirst({
      where: eq(aiTools.status, "active"),
      columns: { id: true, name: true },
    });
    expect(tool).toBeTruthy();
    const res = await POST(makeRequest(basePayload({ toolName: tool!.name })));
    expect(res.status).toBe(201);
    const json = await trackCreated(res);
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, json.data!.requestId!),
    });
    expect(row?.requestedToolId).toBe(tool!.id);
    expect(row?.requesterRole).toBeNull();
  });

  it("400s when neither role nor tool is given", async () => {
    const res = await POST(makeRequest(basePayload()));
    expect(res.status).toBe(400);
  });
});
