import { formatDateOnly } from "@/lib/utils";
import { MAX_EXTENSION_CENTS } from "@/lib/validators";
import type { BudgetExtensionCategory } from "@/types";

export { MAX_EXTENSION_CENTS };

export type AllocationMode =
  | "unallocated"
  | "distribute_remaining"
  | "single_period";

export interface ExtensionFormState {
  reason: string;
  amountDollars: string; // user types this; parsed on submit
  /** "+" extension or "-" reduction — kept separate so amountDollars stays a clean number */
  sign: "+" | "-";
  effectiveDate: string;
  category: BudgetExtensionCategory;
  /** Empty string means "no tool linked". */
  linkedToolId: string;
  description: string;
  allocationMode: AllocationMode;
  /** Period id picked when allocationMode === "single_period". Empty string = unselected. */
  singlePeriodId: string;
}

export function makeEmptyExtensionForm(): ExtensionFormState {
  return {
    reason: "",
    amountDollars: "",
    sign: "+",
    effectiveDate: formatDateOnly(new Date()),
    category: "new_tool",
    linkedToolId: "",
    description: "",
    allocationMode: "distribute_remaining",
    singlePeriodId: "",
  };
}

/**
 * Parse the amount field with the SAME rules the submit path uses, so the
 * dialog's live preview can never disagree with what the server will accept.
 * Returns signed cents (positive for "+" sign, negative for "-").
 */
export function parseExtensionCents(
  form: ExtensionFormState
): { ok: true; cents: number } | { ok: false; error: string } {
  if (!form.amountDollars) {
    return { ok: false, error: "Amount is required" };
  }
  // Strip thousands separators ("1,200.50" → "1200.50") and reject anything
  // that isn't a plain decimal — scientific notation, leading "+", or stray
  // characters all produce a clear error rather than a silently-mangled value.
  const cleaned = form.amountDollars.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, error: "Amount must be a plain number (e.g. 1000.50)" };
  }
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || parsed <= 0) {
    return { ok: false, error: "Amount must be a positive number" };
  }
  const cents = Math.round(parsed * 100) * (form.sign === "-" ? -1 : 1);
  if (cents === 0) {
    return { ok: false, error: "Amount must be non-zero" };
  }
  if (Math.abs(cents) > MAX_EXTENSION_CENTS) {
    return {
      ok: false,
      error: `Amount must not exceed $${(MAX_EXTENSION_CENTS / 100).toLocaleString()}`,
    };
  }
  return { ok: true, cents };
}

/**
 * Mirror the server's distribute_remaining math so the dialog's preview text
 * agrees with what createBudgetExtension actually writes (per-period base +
 * remainder dumped onto the first period). See resolveAllocations in
 * src/actions/budget-extensions.ts.
 */
export function previewDistributeRemaining(
  cents: number,
  remainingCount: number
): { perPeriod: number; firstPeriod: number; remainder: number } {
  if (remainingCount <= 0) {
    return { perPeriod: 0, firstPeriod: 0, remainder: 0 };
  }
  const perPeriod = Math.trunc(cents / remainingCount);
  const remainder = cents - perPeriod * remainingCount;
  return { perPeriod, firstPeriod: perPeriod + remainder, remainder };
}

/** Convert a form state into the input shape `createBudgetExtension` expects. */
export function extensionFormToActionInput(
  form: ExtensionFormState,
  budgetId: number
):
  | {
      ok: true;
      input: {
        budgetId: number;
        amountCents: number;
        reason: string;
        description?: string;
        category: BudgetExtensionCategory;
        linkedToolId?: number;
        effectiveDate: string;
        allocation:
          | { mode: "unallocated" }
          | { mode: "distribute_remaining" }
          | { mode: "single_period"; periodId: number };
      };
    }
  | { ok: false; error: string } {
  const reason = form.reason.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Reason must be at least 3 characters" };
  }
  const parsed = parseExtensionCents(form);
  if (!parsed.ok) return parsed;
  const cents = parsed.cents;

  let allocation:
    | { mode: "unallocated" }
    | { mode: "distribute_remaining" }
    | { mode: "single_period"; periodId: number };
  switch (form.allocationMode) {
    case "unallocated":
      allocation = { mode: "unallocated" };
      break;
    case "distribute_remaining":
      allocation = { mode: "distribute_remaining" };
      break;
    case "single_period": {
      const pid = Number(form.singlePeriodId);
      if (!pid) return { ok: false, error: "Pick a period to allocate to" };
      allocation = { mode: "single_period", periodId: pid };
      break;
    }
  }

  return {
    ok: true,
    input: {
      budgetId,
      amountCents: cents,
      reason,
      description: form.description.trim() || undefined,
      category: form.category,
      linkedToolId: form.linkedToolId ? Number(form.linkedToolId) : undefined,
      effectiveDate: form.effectiveDate,
      allocation,
    },
  };
}

export const CATEGORY_OPTIONS: { value: BudgetExtensionCategory; label: string }[] = [
  { value: "new_tool", label: "New tool" },
  { value: "scope_increase", label: "Scope increase" },
  { value: "seat_increase", label: "Seat increase" },
  { value: "vendor_price_increase", label: "Vendor price increase" },
  { value: "reallocation", label: "Reallocation" },
  { value: "other", label: "Other" },
];

export const CATEGORY_LABEL: Record<BudgetExtensionCategory, string> =
  Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label])) as Record<
    BudgetExtensionCategory,
    string
  >;
