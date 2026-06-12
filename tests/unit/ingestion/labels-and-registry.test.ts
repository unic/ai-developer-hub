import { describe, it, expect } from "vitest";
import {
  buildIngestionLabel,
  INGESTION_KIND_LABELS,
} from "@/lib/ingestion/labels";
import { INGESTION_TYPES, presentKinds } from "@/lib/ingestion/registry";
import type { IngestionLogRow } from "@/actions/ingestion-log";

describe("buildIngestionLabel", () => {
  it("renders vendor · amount for an invoice", () => {
    expect(
      buildIngestionLabel({
        kind: "invoice",
        vendor: "Anthropic",
        amountCents: 124000,
      }),
    ).toBe("Anthropic · $1,240.00");
  });

  it("falls back to invoice number then filename then 'Invoice'", () => {
    expect(
      buildIngestionLabel({ kind: "invoice", invoiceNumber: "INV-9" }),
    ).toBe("INV-9");
    expect(buildIngestionLabel({ kind: "invoice", filename: "a.pdf" })).toBe(
      "a.pdf",
    );
    expect(buildIngestionLabel({ kind: "invoice" })).toBe("Invoice");
  });

  it("renders requester → tool for a license request", () => {
    expect(
      buildIngestionLabel({
        kind: "license_request",
        requesterName: "J. Doe",
        toolName: "Copilot Business",
        deduped: false,
      }),
    ).toBe("J. Doe → Copilot Business");
  });

  it("marks duplicate (idempotent replay) license requests", () => {
    expect(
      buildIngestionLabel({
        kind: "license_request",
        requesterName: "K. Li",
        toolName: "Cursor",
        deduped: true,
      }),
    ).toBe("K. Li → Cursor (duplicate)");
  });

  it("uses email then 'Unknown' / 'tool' fallbacks for license requests", () => {
    expect(
      buildIngestionLabel({
        kind: "license_request",
        requesterEmail: "x@y.com",
        deduped: false,
      }),
    ).toBe("x@y.com → tool");
    expect(
      buildIngestionLabel({ kind: "license_request", deduped: false }),
    ).toBe("Unknown → tool");
  });
});

describe("INGESTION_TYPES registry", () => {
  const row = (over: Partial<IngestionLogRow>): IngestionLogRow => ({
    id: 1,
    kind: "invoice",
    sourceType: null,
    outcome: "success",
    channel: "api",
    label: null,
    errorMessage: null,
    entityType: null,
    entityId: null,
    details: null,
    uploaderName: null,
    createdAt: new Date().toISOString(),
    vendor: null,
    ...over,
  });

  it("covers every kind label", () => {
    for (const k of Object.keys(INGESTION_TYPES) as Array<
      keyof typeof INGESTION_TYPES
    >) {
      expect(INGESTION_TYPES[k].label).toBe(INGESTION_KIND_LABELS[k]);
    }
  });

  it("invoice drills through to the PDF endpoint, opens in a new tab", () => {
    const def = INGESTION_TYPES.invoice;
    expect(
      def.drillThrough(
        row({ kind: "invoice", entityType: "invoice", entityId: 42 }),
      ),
    ).toBe("/api/invoices/42/pdf");
    expect(def.drillNewTab).toBe(true);
  });

  it("license request drills through to the request page, same tab", () => {
    const def = INGESTION_TYPES.license_request;
    expect(
      def.drillThrough(
        row({
          kind: "license_request",
          entityType: "license_request",
          entityId: 7,
        }),
      ),
    ).toBe("/requests/7");
    expect(def.drillNewTab).toBe(false);
  });

  it("returns null drill-through when entity is missing or mismatched", () => {
    expect(
      INGESTION_TYPES.invoice.drillThrough(row({ entityId: null })),
    ).toBeNull();
    expect(
      INGESTION_TYPES.invoice.drillThrough(
        row({ entityType: "license_request", entityId: 7 }),
      ),
    ).toBeNull();
  });
});

describe("presentKinds", () => {
  it("returns only kinds present, in registry order", () => {
    const rows = [
      { kind: "license_request" },
      { kind: "invoice" },
      { kind: "invoice" },
    ] as IngestionLogRow[];
    expect(presentKinds(rows)).toEqual(["invoice", "license_request"]);
  });
});
