import { describe, expect, it } from "vitest";
import {
  canonicalizeAnthropicInvoiceNumber,
  parseInvoiceNumberFromText,
} from "@/lib/invoice-number";

const OLD_RECEIPT_TAIL =
  "  Receipt number 2101-9445-9411 Date paid August 11, 2026 Anthropic, PBC";

describe("parseInvoiceNumberFromText", () => {
  it.each([
    ["K6EV5YRI-0101", "K6EV5YRI 0101"],
    ["K6EV5YRI 0101", "K6EV5YRI 0101"],
    ["K6EV5YRI0095", "K6EV5YRI 0095"],
  ])("reads old PBC format %s as %s", (raw, canonical) => {
    const text = `Invoice number ${raw}${OLD_RECEIPT_TAIL}`;
    expect(parseInvoiceNumberFromText(text)).toEqual({
      status: "ok",
      invoiceNumber: canonical,
    });
  });

  it("reads a dashed Ireland receipt", () => {
    const text =
      "Invoice number 9BF0758D-10147934  Receipt number 2707-6864 Date paid October 24, 2026";
    expect(parseInvoiceNumberFromText(text)).toEqual({
      status: "ok",
      invoiceNumber: "9BF0758D 10147934",
    });
  });

  it("reads the space-collapsed Ireland extraction and ignores the receipt number", () => {
    const text =
      "Receipt  Invoice number   9BF0758D   10147934  Receipt number   2707   6864 Date paid   October 24, 2026 ... Anthropic Ireland, Limited ... $67.08 paid on October 24, 2026";
    const parsed = parseInvoiceNumberFromText(text);
    expect(parsed).toEqual({
      status: "ok",
      invoiceNumber: "9BF0758D 10147934",
    });
    if (parsed.status === "ok") {
      expect(parsed.invoiceNumber).not.toContain("2707");
      expect(parsed.invoiceNumber).not.toContain("6864");
    }
  });

  it("fails when the label is present and the suffix is missing", () => {
    const text =
      "Receipt  Invoice number   9BF0758D  Receipt number   2707   6864 Date paid   October 24, 2026 Anthropic Ireland, Limited";
    const parsed = parseInvoiceNumberFromText(text);
    expect(parsed.status).toBe("error");
    if (parsed.status === "error") {
      expect(parsed.error).toMatch(/no numeric suffix/i);
      expect(parsed.error).toContain("9BF0758D");
    }
    expect(parsed).not.toHaveProperty("invoiceNumber");
  });

  it("does not treat a generic invoice number as an Anthropic prefix", () => {
    const text = "Invoice number INV-1042  Total $12.50";
    expect(parseInvoiceNumberFromText(text)).toEqual({ status: "absent" });
  });
});

describe("canonicalizeAnthropicInvoiceNumber", () => {
  it("normalizes dash, spaces, and a missing separator to one space", () => {
    expect(canonicalizeAnthropicInvoiceNumber("K6EV5YRI-0101")).toBe(
      "K6EV5YRI 0101",
    );
    expect(canonicalizeAnthropicInvoiceNumber("9BF0758D   10147934")).toBe(
      "9BF0758D 10147934",
    );
    expect(canonicalizeAnthropicInvoiceNumber("K6EV5YRI0095")).toBe(
      "K6EV5YRI 0095",
    );
  });

  it("does not invent a suffix for a bare prefix", () => {
    expect(canonicalizeAnthropicInvoiceNumber("9BF0758D")).toBeNull();
    expect(canonicalizeAnthropicInvoiceNumber("K6EV5YRI")).toBeNull();
  });
});
