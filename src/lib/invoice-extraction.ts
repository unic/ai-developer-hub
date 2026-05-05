import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getDocumentProxy, extractText } from "unpdf";
import Anthropic from "@anthropic-ai/sdk";
import { getR2Client, getR2Bucket } from "@/lib/r2-client";
import { invoiceExtractionResultSchema } from "@/lib/validators";
import type { InvoiceExtractionResult } from "@/lib/validators";
import { env } from "@/lib/env";

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

const EXTRACTION_TOOL = {
  name: "extract_invoice_fields",
  description: "Extract structured invoice fields from invoice text",
  input_schema: {
    type: "object" as const,
    properties: {
      invoice_number: {
        type: ["string", "null"],
        description: "Vendor invoice identifier, e.g. INV-1042. Null if not found.",
      },
      invoice_date: {
        type: ["string", "null"],
        description: "Invoice issue date in YYYY-MM-DD format. Null if not found.",
      },
      amount_cents: {
        type: ["integer", "null"],
        description:
          "Total amount due in integer cents (e.g. $12.50 → 1250). Grand total only. Null if not found.",
      },
      vendor: {
        type: ["string", "null"],
        description:
          "Name of the vendor or company issuing the invoice. Null if not found.",
      },
      confidence: {
        type: "object",
        properties: {
          invoice_number: { type: "string", enum: ["high", "medium", "low"] },
          invoice_date: { type: "string", enum: ["high", "medium", "low"] },
          amount_cents: { type: "string", enum: ["high", "medium", "low"] },
          vendor: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["invoice_number", "invoice_date", "amount_cents", "vendor"] as string[],
      },
    },
    required: ["invoice_number", "invoice_date", "amount_cents", "vendor", "confidence"] as string[],
  },
};

function regexFallback(text: string): InvoiceExtractionResult {
  const invoiceNumberMatch = text.match(
    /(?:invoice\s*(?:number|no\.?|#)\s*:?\s*)([A-Z0-9\-]+)/i
  );
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2}\/\d{1,2}\/\d{4})\b/
  );
  const amountMatch = text.match(
    /(?:total|amount\s*due|grand\s*total)\s*:?\s*\$?([\d,]+\.?\d{0,2})/i
  );

  let invoiceDate: string | null = null;
  if (dateMatch) {
    if (dateMatch[1]) {
      invoiceDate = dateMatch[1];
    } else if (dateMatch[2]) {
      const [m, d, y] = dateMatch[2].split("/");
      invoiceDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  let amountCents: number | null = null;
  if (amountMatch) {
    const dollars = parseFloat(amountMatch[1].replace(/,/g, ""));
    if (!Number.isNaN(dollars)) {
      amountCents = Math.round(dollars * 100);
    }
  }

  // Vendor heuristic: look for "From: Company" or capitalised proper noun on first 3 lines
  const firstLines = text.split("\n").slice(0, 3).join("\n");
  const fromMatch = firstLines.match(/From:\s*(.+)/i);
  const vendor = fromMatch ? fromMatch[1].trim() : null;

  return {
    invoiceNumber: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    invoiceDate,
    amountCents,
    vendor,
    confidence: {
      invoiceNumber: "low",
      invoiceDate: "low",
      amountCents: "low",
      vendor: "low",
    },
  };
}

export async function extractInvoiceFields({
  objectKey,
  pdfBytes: providedBytes,
}: {
  objectKey: string;
  pdfBytes?: Uint8Array;
}): Promise<{ success: true; data: InvoiceExtractionResult } | { success: false; error: string }> {
  // 1. Fetch PDF bytes from R2
  let pdfBytes: Uint8Array;
  if (providedBytes) {
    pdfBytes = providedBytes;
  } else {
    try {
      const command = new GetObjectCommand({ Bucket: getR2Bucket(), Key: objectKey });
      const response = await getR2Client().send(command);
      if (!response.Body) {
        return { success: false, error: "Empty response from storage" };
      }
      pdfBytes = await (response.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: `Failed to fetch PDF from storage: ${message}` };
    }
  }

  // 2. Extract text with unpdf
  let text: string;
  try {
    const pdf = await getDocumentProxy(pdfBytes);
    const { text: extracted } = await extractText(pdf, { mergePages: true });
    text = extracted;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Failed to extract text from PDF: ${message}` };
  }

  // 3. Check text length
  if (text.trim().length < 50) {
    return { success: false, error: "PDF has no readable text layer" };
  }

  // 4. Call Claude Haiku with forced tool use; fall back to regex on any failure
  const fallback = regexFallback(text);
  let rawResult: InvoiceExtractionResult;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_invoice_fields" },
      messages: [
        {
          role: "user",
          content: `Extract the invoice fields from this invoice text:\n\n${text.slice(0, 8000)}`,
        },
      ],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      rawResult = fallback;
    } else {
      const input = toolUse.input as Record<string, unknown>;
      const conf = (input.confidence ?? {}) as Record<string, unknown>;
      rawResult = {
        invoiceNumber: typeof input.invoice_number === "string" ? input.invoice_number : null,
        invoiceDate: typeof input.invoice_date === "string" ? input.invoice_date : null,
        amountCents: typeof input.amount_cents === "number" ? input.amount_cents : null,
        vendor: typeof input.vendor === "string" ? input.vendor : null,
        confidence: {
          invoiceNumber: (conf.invoice_number as "high" | "medium" | "low") ?? "low",
          invoiceDate: (conf.invoice_date as "high" | "medium" | "low") ?? "low",
          amountCents: (conf.amount_cents as "high" | "medium" | "low") ?? "low",
          vendor: (conf.vendor as "high" | "medium" | "low") ?? "low",
        },
      };
    }
  } catch {
    rawResult = fallback;
  }

  // 5. Validate with Zod; return cached fallback if Claude output is malformed
  const parsed = invoiceExtractionResultSchema.safeParse(rawResult);
  return { success: true, data: parsed.success ? parsed.data : fallback };
}
