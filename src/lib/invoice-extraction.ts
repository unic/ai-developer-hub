import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getDocumentProxy, extractText } from "unpdf";
import Anthropic from "@anthropic-ai/sdk";
import { invoiceExtractionResultSchema } from "@/lib/validators";
import type { InvoiceExtractionResult } from "@/lib/validators";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? "",
  },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
      confidence: {
        type: "object",
        properties: {
          invoice_number: { type: "string", enum: ["high", "medium", "low"] },
          invoice_date: { type: "string", enum: ["high", "medium", "low"] },
          amount_cents: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["invoice_number", "invoice_date", "amount_cents"] as string[],
      },
    },
    required: ["invoice_number", "invoice_date", "amount_cents", "confidence"] as string[],
  },
};

function regexFallback(text: string): InvoiceExtractionResult {
  // Try to extract invoice number (patterns like INV-1234, Invoice #1234, etc.)
  const invoiceNumberMatch = text.match(
    /(?:invoice\s*(?:number|no\.?|#)\s*:?\s*)([A-Z0-9\-]+)/i
  );
  // Try to extract date (YYYY-MM-DD or MM/DD/YYYY or Month DD, YYYY)
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2}\/\d{1,2}\/\d{4})\b/
  );
  // Try to extract total amount (patterns like Total: $1,234.56)
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
    if (!isNaN(dollars)) {
      amountCents = Math.round(dollars * 100);
    }
  }

  return {
    invoiceNumber: invoiceNumberMatch ? invoiceNumberMatch[1] : null,
    invoiceDate,
    amountCents,
    confidence: {
      invoiceNumber: "low",
      invoiceDate: "low",
      amountCents: "low",
    },
  };
}

export async function extractInvoiceFields({
  objectKey,
}: {
  objectKey: string;
}): Promise<{ success: true; data: InvoiceExtractionResult } | { success: false; error: string }> {
  // 1. Fetch PDF bytes from R2
  let pdfBytes: Uint8Array;
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
    });
    const response = await r2Client.send(command);
    if (!response.Body) {
      return { success: false, error: "Empty response from storage" };
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    pdfBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      pdfBytes.set(chunk, offset);
      offset += chunk.length;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Failed to fetch PDF from storage: ${message}` };
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

  // 4. Call Claude Haiku with forced tool use
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
      rawResult = regexFallback(text);
    } else {
      const input = toolUse.input as Record<string, unknown>;
      const conf = (input.confidence ?? {}) as Record<string, unknown>;
      rawResult = {
        invoiceNumber: typeof input.invoice_number === "string" ? input.invoice_number : null,
        invoiceDate: typeof input.invoice_date === "string" ? input.invoice_date : null,
        amountCents: typeof input.amount_cents === "number" ? input.amount_cents : null,
        confidence: {
          invoiceNumber: (conf.invoice_number as "high" | "medium" | "low") ?? "low",
          invoiceDate: (conf.invoice_date as "high" | "medium" | "low") ?? "low",
          amountCents: (conf.amount_cents as "high" | "medium" | "low") ?? "low",
        },
      };
    }
  } catch {
    rawResult = regexFallback(text);
  }

  // 5. Validate with Zod
  const parsed = invoiceExtractionResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    // Return regex fallback with low confidence on validation failure
    return { success: true, data: regexFallback(text) };
  }

  return { success: true, data: parsed.data };
}
