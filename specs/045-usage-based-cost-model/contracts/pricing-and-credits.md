# Contract: Pricing Models, Credits and Limits

**Feature**: 045-usage-based-cost-model | **Date**: 2026-09-18

Normative rules for what a tier price means, how expected spend is computed, how credit purchases are kept out of cost, and how a recorded workspace cap behaves.

Companion to [cost-attribution.md](./cost-attribution.md), which covers per-user attribution of billed cost.

## 1. Pricing models

Every `access_tier` carries `pricing_model`:

| Value            | `monthly_cost_cents` means                               | Expected spend basis |
| ---------------- | -------------------------------------------------------- | -------------------- |
| `seat` (default) | a recurring monthly **cost** per assignment              | the tier price       |
| `usage`          | a monthly **allowance** — how much that person may spend | measured consumption |

- **P1** — A `seat` tier's behaviour MUST be byte-identical to before this feature, everywhere. Wording, arithmetic, forecast.
- **P2** — A `usage` tier's price is never presented as a cost. Every surface showing it labels it an allowance (§4).
- **P3** — The column keeps its name. `pricing_model` changes interpretation, not storage (research.md D6).

## 2. Expected spend

For a tool `t` and budget period `p`:

```
if pricing_model(t) == "seat":
    expected = Σ tier_price(a) for assignments a active in p     basis = "tier_price"

else:  # usage
    if p is complete AND consumption data exists for p:
        expected = measured_consumption(t, p)                    basis = "measured"
    else if ≥1 complete month of consumption exists:
        expected = mean(measured_consumption(t, m))              basis = "projected"
                   over the last 3 complete months with data
    else:
        expected = Σ allowance(a) for assignments a active in p  basis = "allowance_fallback"
```

- **P4** — `measured_consumption` for Anthropic is the attributed billed cost for the period (contracts/cost-attribution.md), **not** the token-derived estimate and **not** invoice totals.
- **P5** — The projection window is 3 complete months by default. It is a constant in one pure function so it can be changed without touching callers (spec OQ-2).
- **P6** — Partial months are never used as projection input; a half-month would bias the mean downward.
- **P7** — Every `ExpectedSpend` value carries its `basis`. A figure whose basis is `allowance_fallback` is a placeholder, and any surface aggregating it MUST be able to say so.
- **P8** — Mixed portfolios sum normally: a period's expected spend is the sum across tools, each computed by its own basis.

## 3. Credit purchases

Applies to `usage` tools, whose access is prepaid.

- **C1** — An invoice MAY be recorded as a credit purchase. This is an explicit admin act; it is never inferred from the amount, the vendor or the date (research.md D9).
- **C2** — Period **cost** for a `usage` tool is its measured consumption. A credit purchase landing in a period MUST NOT increase that period's cost.
- **C3** — The period-cost query MUST exclude `billed_costs` rows whose invoice has a `credit_purchases` entry, rather than requiring the link to be removed. Reclassifying an already-linked invoice must not need the link unpicked.
- **C4** — The derived credit balance is:

  ```
  balance = opening_balance
          + Σ purchases      where purchased_at  > opening_balance_at
          − Σ consumption    where date          > opening_balance_at
  ```

- **C5** — With no `credit_opening_balance_cents` recorded, the balance is reported as **unavailable**. It is never derived from an assumed opening of zero (FR-016).
- **C6** — Every displayed balance states its as-of date and that the Hub derived it. Anthropic's Admin API does not expose a credit balance, so this figure is the Hub's arithmetic, not a reading (research.md D10).
- **C7** — A balance that has gone negative is displayed as such, not clamped — it means purchases or consumption are missing, which is exactly what the reader needs to know.

## 4. Labelling

- **L1** — A money figure for a `usage` tier is labelled by what it is: **allowance** (tier price), **consumption** (measured cost), **purchase** (credit top-up), or **balance** (derived).
- **L2** — Labels are text, not colour alone (constitution IV).
- **L3** — Seat-based wording is untouched. No relabelling ripples into tools that were never affected.
- **L4** — Where allowance, consumption and purchases appear together, they are visually distinct and never summed into a single total.
- **L5** — An expected-spend figure displays its basis (§2) wherever a reader could mistake a projection for a measurement.

## 5. Workspace limits

The Hub **mirrors** the cap an admin sets in the Claude Console. It does not set or enforce anything — the Admin API exposes no endpoint for spend limits (research.md D10).

- **W1** — A recorded cap carries `confirmed_at` and `confirmed_by`. Every surface showing the cap shows when it was last confirmed.
- **W2** — Three states are distinct and never collapsed: **no cap recorded** (no row), **a recorded cap of zero**, and **a recorded cap of N**. "No cap recorded" is never rendered as unlimited or as 0.
- **W3** — Utilisation is measured consumption for the current period over the recorded cap. Threshold flagging reuses the existing 80% / 100% semantics.
- **W4** — When a recorded cap differs from the sum of its owners' tier allowances, both figures are shown and the difference is flagged. Neither is authoritative over the other — they are two independently maintained numbers and the flag says so.
- **W5** — Every cap surface states that the Hub does not enforce the limit.
- **W6** — Deprecated workspaces are excluded from cap views, cap aggregates and alerting (contracts/cost-attribution.md I5).

## 6. Invariants

- **J1** — For a `seat` tool, expected spend for any period equals the value it had before this feature.
- **J2** — For a `usage` tool and a complete period with consumption data, expected spend equals that period's measured consumption.
- **J3** — Recording, reclassifying or deleting a credit purchase never changes any period's reported cost.
- **J4** — `balance = opening + purchases − consumption` holds whenever an opening balance is recorded.
- **J5** — Recording or changing a workspace cap never changes any cost, consumption or expected-spend figure.
- **J6** — No total anywhere sums an allowance with a consumption or a purchase.
