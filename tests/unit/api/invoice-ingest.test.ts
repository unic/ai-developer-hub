import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

process.env.INVOICE_INGEST_SECRET = "test-ingest-secret-123456";

interface StoredInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  vendor: string | null;
  linkedBilledCostId: number | null;
}

const state = vi.hoisted(() => ({
  rows: [] as StoredInvoice[],
  nextId: 1,
}));

const { mockExtract, mockSend, mockLog } = vi.hoisted(() => ({
  mockExtract: vi.fn(),
  mockSend: vi.fn(async () => ({})),
  mockLog: vi.fn(async () => {}),
}));

function stringsIn(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): string[] {
  if (value == null || depth > 8) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((entry) => stringsIn(entry, depth + 1, seen));
  }
  return Object.values(value).flatMap((entry) =>
    stringsIn(entry, depth + 1, seen),
  );
}

vi.mock("@/lib/auth-helpers", () => ({
  requireBearerSecret: (
    request: NextRequest,
    envVarName: string,
  ): NextResponse | null => {
    const expected = process.env[envVarName];
    if (!expected) {
      return NextResponse.json(
        {
          success: false,
          error: `Server misconfigured: ${envVarName} is not set`,
        },
        { status: 500 },
      );
    }
    if (request.headers.get("authorization") !== `Bearer ${expected}`) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    return null;
  },
  getSystemAdminUserId: async () => 1,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      invoices: {
        findFirst: async (query: { where: unknown }) => {
          const wanted = stringsIn(query.where);
          return (
            state.rows.find((row) => wanted.includes(row.invoiceNumber)) ??
            undefined
          );
        },
      },
    },
    select: () => ({
      from: () => ({
        where: async () => state.rows,
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({
          values: (vals: Record<string, unknown>) => ({
            returning: async () => {
              if (typeof vals.invoiceNumber === "string") {
                const id = state.nextId++;
                state.rows.push({
                  id,
                  invoiceNumber: vals.invoiceNumber,
                  invoiceDate: String(vals.invoiceDate),
                  amountCents: Number(vals.amountCents),
                  vendor: (vals.vendor as string | null) ?? null,
                  linkedBilledCostId:
                    (vals.linkedBilledCostId as number | null) ?? null,
                });
                return [{ id }];
              }
              return [{ id: state.nextId++ }];
            },
          }),
        }),
      };
      return fn(tx);
    },
  },
}));

vi.mock("@/lib/invoice-extraction", () => ({
  extractInvoiceFields: mockExtract,
}));

vi.mock("@/lib/r2-client", () => ({
  getR2Client: () => ({ send: mockSend }),
  getR2Bucket: () => "bucket",
  getR2AccountId: () => "account",
}));

vi.mock("@/lib/ingestion-logger", () => ({
  logIngestionAttempt: mockLog,
}));

vi.mock("@/lib/ingestion-filters", () => ({
  evaluateIngestionFilters: async () => ({
    filteredOut: false,
    matchedRule: null,
    reason: null,
  }),
}));

vi.mock("@/lib/budget-utils", () => ({
  findPeriodForDate: async () => ({ id: 7, periodLabel: "Oct 2026" }),
}));

import { POST } from "@/app/api/invoices/ingest/route";

function pdfRequest(): NextRequest {
  const body = new Uint8Array(64);
  body.set(new TextEncoder().encode("%PDF-1.4"), 0);
  return new NextRequest("http://localhost/api/invoices/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      authorization: "Bearer test-ingest-secret-123456",
      "x-filename": "receipt.pdf",
    },
    body,
  });
}

function extracted(
  invoiceNumber: string,
  amountCents: number,
  invoiceDate: string,
) {
  mockExtract.mockResolvedValueOnce({
    success: true,
    data: {
      invoiceNumber,
      invoiceDate,
      amountCents,
      vendor: "Anthropic Ireland, Limited",
      confidence: {
        invoiceNumber: "high",
        invoiceDate: "high",
        amountCents: "high",
        vendor: "high",
      },
    },
  });
}

describe("POST /api/invoices/ingest invoice numbers", () => {
  beforeEach(() => {
    state.rows = [];
    state.nextId = 1;
    mockExtract.mockReset();
    mockSend.mockClear();
    mockLog.mockClear();
  });

  it("accepts two Ireland receipts with the same prefix and rejects a re-post", async () => {
    extracted("9BF0758D 10147934", 6708, "2026-10-24");
    const first = await POST(pdfRequest());
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      success: boolean;
      data: { invoiceId: number; invoiceNumber: string };
    };
    expect(firstBody.data.invoiceNumber).toBe("9BF0758D 10147934");

    extracted("9BF0758D 10148000", 1200, "2026-10-25");
    const second = await POST(pdfRequest());
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      success: boolean;
      data: { invoiceId: number; invoiceNumber: string };
    };
    expect(secondBody.data.invoiceNumber).toBe("9BF0758D 10148000");
    expect(secondBody.data.invoiceId).not.toBe(firstBody.data.invoiceId);

    extracted("9BF0758D 10147934", 6708, "2026-10-24");
    const again = await POST(pdfRequest());
    expect(again.status).toBe(409);
    const againBody = (await again.json()) as {
      success: boolean;
      error: string;
      data: { existingInvoiceId: number };
    };
    expect(againBody.success).toBe(false);
    expect(againBody.error).toBe("Invoice 9BF0758D 10147934 already exists");
    expect(againBody.data.existingInvoiceId).toBe(firstBody.data.invoiceId);
    expect(mockSend).toHaveBeenCalledTimes(2);

    const numbers = state.rows.map((row) => row.invoiceNumber);
    expect(numbers).toEqual(["9BF0758D 10147934", "9BF0758D 10148000"]);
  });

  it("returns 422 and stores nothing when the suffix was not captured", async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error:
        'Invoice number label is present but no numeric suffix was captured after "9BF0758D". Refusing to store a partial invoice number.',
    });

    const res = await POST(pdfRequest());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/no numeric suffix/i);
    expect(state.rows).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
