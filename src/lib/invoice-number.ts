/**
 * Anthropic receipt invoice numbers.
 *
 * Canonical stored form is "PREFIX SUFFIX" with a single space, for example
 * "K6EV5YRI 0101" and "9BF0758D 10147934". Rows already in the archive use
 * that form. PDF text extraction may keep a dash ("K6EV5YRI-0101"), collapse
 * it to whitespace ("9BF0758D   10147934"), or drop the separator
 * ("K6EV5YRI0095"). All three normalize to the single space so a re-ingest
 * matches the stored row instead of looking like a new invoice.
 *
 * The prefix is 8 alphanumeric characters. The suffix is digits of any length
 * (4 on Anthropic, PBC receipts, 8 or more on Anthropic Ireland receipts).
 * When the invoice-number label is present but the suffix is missing, parsing
 * fails instead of storing the prefix. That prefix-only value is what made
 * every Ireland receipt collide on "9BF0758D".
 */

export type InvoiceNumberParseResult =
  | { status: "ok"; invoiceNumber: string }
  | { status: "error"; error: string }
  | { status: "absent" };

const INVOICE_LABEL = /invoice\s*(?:number|no\.?|#)\s*:?\s*/i;

/**
 * 8-character prefix, then a dash, whitespace, or nothing, then a numeric
 * suffix of any length. The suffix stops at the first non-digit, so a
 * following receipt number is not absorbed.
 */
const FULL_NUMBER = /^([A-Z0-9]{8})(?:[-\s]+|(?=\d))(\d+)/i;

const PREFIX_ONLY = /^([A-Z0-9]{8})(?![A-Z0-9])/i;

export function partialInvoiceNumberError(prefix: string): string {
  return (
    `Invoice number label is present but no numeric suffix was captured after "${prefix}". ` +
    "Refusing to store a partial invoice number."
  );
}

/**
 * Normalize an already-extracted Anthropic receipt number to "PREFIX SUFFIX".
 * Returns null when `raw` is not that shape (including a bare 8-character
 * prefix, which is the truncated form and must not be invented into a suffix).
 */
export function canonicalizeAnthropicInvoiceNumber(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const full = trimmed.match(/^([A-Z0-9]{8})(?:[-\s]+)?(\d+)$/i);
  if (!full) return null;
  return `${full[1].toUpperCase()} ${full[2]}`;
}

/** The 8-character prefix, when `invoiceNumber` is an Anthropic receipt number or a bare prefix. */
export function anthropicInvoicePrefix(invoiceNumber: string): string | null {
  const canonical = canonicalizeAnthropicInvoiceNumber(invoiceNumber);
  if (canonical) return canonical.slice(0, 8);
  const bare = invoiceNumber.trim().match(/^([A-Z0-9]{8})$/i);
  return bare ? bare[1].toUpperCase() : null;
}

/** True when both values are the same receipt number, ignoring dash vs space. */
export function sameCanonicalInvoiceNumber(a: string, b: string): boolean {
  const left = canonicalizeAnthropicInvoiceNumber(a);
  const right = canonicalizeAnthropicInvoiceNumber(b);
  if (left && right) return left === right;
  return a.trim() === b.trim();
}

/**
 * True when `stored` is only the 8-character prefix of a full incoming number.
 * That is the pre-fix truncation, not a different suffix.
 */
export function isTruncatedPrefix(stored: string, incoming: string): boolean {
  const full = canonicalizeAnthropicInvoiceNumber(incoming);
  if (!full) return false;
  return stored.trim().toUpperCase() === full.slice(0, 8);
}

/**
 * Read an Anthropic receipt invoice number from PDF text.
 * `absent` means this text is not that label-plus-prefix shape (other vendors
 * still use the generic extractor). `error` means the label and prefix are
 * present and the suffix is not — callers must fail the ingest.
 */
export function parseInvoiceNumberFromText(
  text: string,
): InvoiceNumberParseResult {
  const label = INVOICE_LABEL.exec(text);
  if (!label) return { status: "absent" };

  const after = text.slice(label.index + label[0].length);
  const full = FULL_NUMBER.exec(after);
  if (full) {
    return {
      status: "ok",
      invoiceNumber: `${full[1].toUpperCase()} ${full[2]}`,
    };
  }

  const prefixOnly = PREFIX_ONLY.exec(after);
  if (prefixOnly) {
    return {
      status: "error",
      error: partialInvoiceNumberError(prefixOnly[1].toUpperCase()),
    };
  }

  return { status: "absent" };
}
