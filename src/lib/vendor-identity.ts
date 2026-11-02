/**
 * Anthropic bills the same Hub subscription under two legal names:
 * "Anthropic, PBC" before September 2026, and "Anthropic Ireland, Limited"
 * on the Stripe receipts after that. Tool rows use the short vendor
 * "Anthropic". Grouping, ingestion allow-lists, and Claude credit-purchase
 * candidate queries treat all of these as one vendor.
 *
 * Budget-period linking does not use the vendor string. It matches the
 * invoice date to a period (`findPeriodForDate`), so an Ireland receipt
 * links the same way a PBC receipt does.
 *
 * The legal name is still stored on the invoice. Only comparisons collapse.
 */

const ANTHROPIC_VENDORS = new Set([
  "anthropic",
  "anthropic, pbc",
  "anthropic pbc",
  "anthropic ireland, limited",
  "anthropic ireland limited",
  "anthropic ireland, ltd",
  "anthropic ireland ltd",
]);

export function normalizeVendorName(vendor: string): string {
  return vendor.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

export function isAnthropicVendor(vendor: string | null | undefined): boolean {
  if (!vendor) return false;
  return ANTHROPIC_VENDORS.has(normalizeVendorName(vendor));
}

/** PDF text names Anthropic (PBC, Ireland, or the short name). Other suppliers do not. */
export function isAnthropicReceiptText(text: string): boolean {
  return /anthropic/i.test(text);
}

/** True when two vendor strings name the same supplier, including the Anthropic legal-name change. */
export function vendorsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (normalizeVendorName(a) === normalizeVendorName(b)) return true;
  return isAnthropicVendor(a) && isAnthropicVendor(b);
}

/**
 * Ingestion-filter vendor rule. Keeps the existing substring match
 * ("anthropic" matches "Anthropic, PBC") and also treats the PBC and Ireland
 * legal names as the same vendor, so a whitelist value of "Anthropic, PBC"
 * accepts an Ireland receipt.
 */
export function vendorFilterMatches(
  invoiceVendor: string,
  ruleValues: string[],
): boolean {
  const vendorLower = invoiceVendor.toLowerCase();
  return ruleValues.some(
    (value) =>
      vendorLower.includes(value.toLowerCase()) ||
      vendorsEquivalent(invoiceVendor, value),
  );
}
