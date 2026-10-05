/**
 * The derived credit balance for a prepaid, usage-based tool.
 *
 * Anthropic API access is prepaid: the organisation buys a dollar amount,
 * consumption draws it down, and a bill arrives when the balance is topped up.
 * Those are two different events on unrelated dates, so a top-up must never be
 * counted as the cost of the month it lands in.
 *
 * The Admin API exposes no credit balance at all, so this figure is the Hub's
 * arithmetic over an admin-entered opening balance — never a reading. That is
 * why it always carries its as-of date, and why "no opening balance recorded"
 * is reported as unavailable rather than derived from an assumed zero (C5).
 *
 * Pure. Rules are C1-C7 in
 * specs/045-usage-based-cost-model/contracts/pricing-and-credits.md.
 */

export interface CreditPurchaseRecord {
  /** YYYY-MM-DD. */
  purchasedAt: string;
  amountCents: number;
}

export interface CreditBalance {
  toolId: number;
  /** False when no opening balance is recorded — then every figure below is 0. */
  available: boolean;
  openingCents: number;
  purchasedCents: number;
  consumedCents: number;
  balanceCents: number;
  /** The opening balance's as-of date (YYYY-MM-DD), or null when unavailable. */
  asOf: string | null;
}

export interface DeriveCreditBalanceInput {
  toolId: number;
  /** Null when no opening balance has been recorded. */
  openingCents: number | null;
  /** YYYY-MM-DD, or null. */
  openingAt: string | null;
  purchases: readonly CreditPurchaseRecord[];
  /** Measured consumption keyed YYYY-MM-DD. */
  consumptionByDay: ReadonlyMap<string, number>;
}

export function deriveCreditBalance(
  input: DeriveCreditBalanceInput,
): CreditBalance {
  const { toolId, openingCents, openingAt, purchases, consumptionByDay } = input;

  // No opening balance means no answer. A zero here would read as "you have
  // nothing left", which is a different and possibly alarming claim (C5).
  if (openingCents === null || openingAt === null) {
    return {
      toolId,
      available: false,
      openingCents: 0,
      purchasedCents: 0,
      consumedCents: 0,
      balanceCents: 0,
      asOf: null,
    };
  }

  // Strictly after the as-of date: the opening balance already accounts for
  // everything up to and including it. Counting the same day twice would
  // double-charge whatever happened on it (C4).
  const purchasedCents = purchases
    .filter((p) => p.purchasedAt > openingAt)
    .reduce((sum, p) => sum + p.amountCents, 0);

  let consumedCents = 0;
  for (const [day, cents] of consumptionByDay) {
    if (day > openingAt) consumedCents += cents;
  }

  return {
    toolId,
    available: true,
    openingCents,
    purchasedCents,
    consumedCents,
    // Deliberately not clamped at zero (C7). A negative balance means a top-up
    // was never recorded or the opening figure is stale — exactly what the
    // reader needs to know, and hiding it would make the number useless.
    balanceCents: openingCents + purchasedCents - consumedCents,
    asOf: openingAt,
  };
}

/** One line a surface can print under the balance, never omitted (C6). */
export function creditBalanceProvenance(balance: CreditBalance): string {
  if (!balance.available) {
    return "No opening balance recorded, so the Hub cannot derive a balance. Anthropic's Admin API does not expose one — record the balance shown in the Console to start tracking.";
  }
  return `Derived by the Hub from the opening balance recorded on ${balance.asOf}, plus credit purchases, minus measured consumption since. Not read from Anthropic.`;
}

/** Dollars typed into a form → integer cents, or null if not a plain amount. */
function parseUsdCents(input: string): number | null {
  const trimmed = input.trim();
  // Two decimals at most: a third is a typo, not a fraction of a cent.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/**
 * Parse a top-up amount into cents. Null for anything the server would
 * reject: empty, non-numeric, zero, negative, or more than two decimals.
 */
export function parseCreditAmountCents(input: string): number | null {
  const cents = parseUsdCents(input);
  return cents !== null && cents > 0 ? cents : null;
}

/**
 * Parse an opening balance into cents. Unlike a top-up, zero is a real
 * reading — an exhausted balance — so only negatives and junk are rejected.
 */
export function parseOpeningBalanceCents(input: string): number | null {
  return parseUsdCents(input);
}
