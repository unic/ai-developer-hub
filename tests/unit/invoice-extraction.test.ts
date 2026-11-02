import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockExtractText } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExtractText: vi.fn(),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: mockExtractText,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("@/lib/r2-client", () => ({
  getR2Client: vi.fn(),
  getR2Bucket: vi.fn(),
  getR2AccountId: vi.fn(),
}));

import { extractInvoiceFields } from "@/lib/invoice-extraction";

const IRELAND_TEXT =
  "Receipt  Invoice number   9BF0758D   10147934  Receipt number   2707   6864 Date paid   October 24, 2026 Anthropic Ireland, Limited $67.08 paid on October 24, 2026";

const PREFIX_ONLY_TEXT =
  "Receipt  Invoice number   9BF0758D  Receipt number   2707   6864 Date paid   October 24, 2026 Anthropic Ireland, Limited $67.08";

function claudeNumber(invoiceNumber: string) {
  mockCreate.mockResolvedValue({
    content: [
      {
        type: "tool_use",
        input: {
          invoice_number: invoiceNumber,
          invoice_date: "2026-10-24",
          amount_cents: 6708,
          vendor: "Anthropic Ireland, Limited",
          confidence: {
            invoice_number: "high",
            invoice_date: "high",
            amount_cents: "high",
            vendor: "high",
          },
        },
      },
    ],
  });
}

describe("extractInvoiceFields invoice numbers", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockExtractText.mockReset();
  });

  it("keeps the full Ireland number when the model returns only the prefix", async () => {
    mockExtractText.mockResolvedValue({ text: IRELAND_TEXT });
    claudeNumber("9BF0758D");

    const result = await extractInvoiceFields({
      objectKey: "invoices/test.pdf",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invoiceNumber).toBe("9BF0758D 10147934");
    }
  });

  it("returns an extraction error when the label has no suffix", async () => {
    mockExtractText.mockResolvedValue({ text: PREFIX_ONLY_TEXT });

    const result = await extractInvoiceFields({
      objectKey: "invoices/partial.pdf",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/no numeric suffix/i);
      expect(result.error).not.toBe("9BF0758D");
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
