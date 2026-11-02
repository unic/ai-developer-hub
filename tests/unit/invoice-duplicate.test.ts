import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { chooseConflict, type InvoiceIdentity } from "@/lib/invoice-duplicate";

function row(
  over: Partial<InvoiceIdentity> &
    Pick<InvoiceIdentity, "id" | "invoiceNumber">,
): InvoiceIdentity {
  return {
    invoiceDate: "2026-10-24",
    amountCents: 6708,
    vendor: "Anthropic, PBC",
    linkedBilledCostId: null,
    ...over,
  };
}

const IRELAND = "Anthropic Ireland, Limited";

describe("chooseConflict", () => {
  it("matches the full number and treats dash and space as the same invoice", () => {
    const stored = row({ id: 10, invoiceNumber: "K6EV5YRI-0101" });
    const hit = chooseConflict([stored], {
      invoiceNumber: "K6EV5YRI 0101",
      invoiceDate: "2026-08-11",
      amountCents: 427,
      vendor: IRELAND,
    });
    expect(hit?.id).toBe(10);
  });

  it("accepts two Ireland receipts that share a prefix and differ in suffix", () => {
    const stored = row({
      id: 216,
      invoiceNumber: "9BF0758D 10147934",
      vendor: IRELAND,
    });
    const hit = chooseConflict([stored], {
      invoiceNumber: "9BF0758D 10148000",
      invoiceDate: "2026-10-25",
      amountCents: 1200,
      vendor: IRELAND,
    });
    expect(hit).toBeUndefined();
  });

  it("treats a re-post of a truncated row as the same receipt when vendor, date, and amount match", () => {
    const stored = row({ id: 216, invoiceNumber: "9BF0758D" });
    const hit = chooseConflict([stored], {
      invoiceNumber: "9BF0758D 10147934",
      invoiceDate: "2026-10-24",
      amountCents: 6708,
      vendor: IRELAND,
    });
    expect(hit?.id).toBe(216);
  });

  it("does not collapse a different receipt onto a truncated prefix", () => {
    const stored = row({ id: 216, invoiceNumber: "9BF0758D" });
    const hit = chooseConflict([stored], {
      invoiceNumber: "9BF0758D 10148000",
      invoiceDate: "2026-11-02",
      amountCents: 5000,
      vendor: IRELAND,
    });
    expect(hit).toBeUndefined();
  });
});
