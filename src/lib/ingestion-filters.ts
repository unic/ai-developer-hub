import "server-only";

import { db } from "@/lib/db";
import { ingestionFilters } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type { VendorFilterValue, InvoiceNumberFilterValue } from "@/lib/validators";

export interface FilterEvaluationResult {
  filteredOut: boolean;
  matchedRule: {
    id: number;
    name: string;
    field: string;
    mode: string;
  } | null;
  reason: string | null;
}

type IngestionFilterRule = typeof ingestionFilters.$inferSelect;

/** Fetch all enabled rules, ordered by priority. Cache this for bulk operations. */
export async function fetchEnabledFilterRules(): Promise<IngestionFilterRule[]> {
  return db
    .select()
    .from(ingestionFilters)
    .where(eq(ingestionFilters.enabled, true))
    .orderBy(asc(ingestionFilters.priority), asc(ingestionFilters.id));
}

export async function evaluateIngestionFilters(
  invoice: { vendor: string | null; invoiceNumber: string },
  preloadedRules?: IngestionFilterRule[]
): Promise<FilterEvaluationResult> {
  const rules = preloadedRules ?? (await fetchEnabledFilterRules());

  if (rules.length === 0) {
    return { filteredOut: false, matchedRule: null, reason: null };
  }

  // Phase 1: Evaluate blacklist rules — any match → filtered out
  for (const rule of rules) {
    if (rule.mode !== "blacklist") continue;
    if (matchesRule(rule, invoice)) {
      return {
        filteredOut: true,
        matchedRule: {
          id: rule.id,
          name: rule.name,
          field: rule.field,
          mode: rule.mode,
        },
        reason: `Blocked by blacklist rule '${rule.name}'`,
      };
    }
  }

  // Phase 2: Evaluate whitelist rules — OR across fields
  const whitelistRules = rules.filter((r) => r.mode === "whitelist");
  if (whitelistRules.length === 0) {
    return { filteredOut: false, matchedRule: null, reason: null };
  }

  // If any whitelist rule matches (any field), the invoice passes
  for (const rule of whitelistRules) {
    if (matchesRule(rule, invoice)) {
      return { filteredOut: false, matchedRule: null, reason: null };
    }
  }

  // No whitelist rule matched — filter out, report the first whitelist rule as reason
  const firstWhitelist = whitelistRules[0];
  return {
    filteredOut: true,
    matchedRule: {
      id: firstWhitelist.id,
      name: firstWhitelist.name,
      field: firstWhitelist.field,
      mode: firstWhitelist.mode,
    },
    reason: `No whitelist rule matched (first whitelist: '${firstWhitelist.name}')`,
  };
}

function matchesRule(
  rule: { field: string; value: unknown },
  invoice: { vendor: string | null; invoiceNumber: string }
): boolean {
  if (rule.field === "vendor") {
    if (!invoice.vendor) return false;
    const { values } = rule.value as VendorFilterValue;
    const vendorLower = invoice.vendor.toLowerCase();
    return values.some((v) => vendorLower.includes(v.toLowerCase()));
  }

  if (rule.field === "invoice_number") {
    const { pattern } = rule.value as InvoiceNumberFilterValue;
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(invoice.invoiceNumber);
    } catch {
      return false;
    }
  }

  return false;
}
