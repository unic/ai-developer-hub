# Research: Usage-Based Cost Model

**Feature**: 045-usage-based-cost-model | **Date**: 2026-09-18

Phase 0 decisions, with the evidence behind each.

## D1. Billed cost as the source of truth for complete days

**Decision**: For complete UTC days, per-user cost comes from `cost_report`, not from token counts × price table.

**Evidence**: September 2026 (1–17), comparing each single-owner workspace's billed cost with the Hub's computed figure:

| User                | Billed (Console) | Hub computed | Ratio |
| ------------------- | ---------------- | ------------ | ----- |
| Svenja Haas         | $29.31           | $29.30       | 1.00× |
| Marlon Schlosshauer | $112.55          | $183.48      | 1.63× |
| Oliver Ladner       | $32.83           | $249.32      | 7.59× |

The user whose models were all in the price table matched to the cent; the others tracked the fallback rate exactly. Even after the price-table fix the computed figure stays approximate: Oliver's August re-prices to roughly $23 against $19.30 actually billed, because the computation cannot see cache-TTL split, context-window tier or service tier.

**Alternatives considered**:

- _Keep computing, fix the table faster._ Rejected — makes correctness depend on a human noticing every model launch, which is what failed.
- _Keep computing, model more pricing dimensions._ Rejected — strictly more work than reading the billed number, and wrong again whenever Anthropic changes anything.

## D2. `cost_report` line items instead of a daily total

**Decision**: Call `cost_report` with `group_by[]=workspace_id&group_by[]=description` and store at line-item grain.

**Evidence**: with `group_by[]=description` each row carries `model`, `token_type` (including `cache_creation.ephemeral_1h_input_tokens` vs `…_5m_…`), `context_window` (`0-200k` / `200k-1M`), `service_tier` (`standard` / `batch`) and `inference_geo`. The current sync parses all of it and discards it into one `cost_cents` per workspace-day.

This removes all three "residual modelling gaps" from docs/anthropic-cost-accuracy.md — they become data — and yields per-model cost breakdowns that the user pages currently synthesise from the price table.

**Cost**: ~20 workspaces × ~30 days × a few models × ~5 token types ≈ low tens of thousands of rows per month. Comfortable.

## D3. The current day stays an estimate

**Decision**: Keep the token-derived computation for the current UTC day, and the existing calibration in `src/lib/anthropic/estimate-today.ts`.

**Evidence**: the Cost API reference lists `bucket_width` as `optional "1d"` — the only accepted value — and returns "time buckets that **end before** `ending_at`". Today's bucket ends at tomorrow's midnight, so it is never returned.

What is **no longer** true: the docs FAQ states usage _and cost_ data both appear within ~5 minutes. Cost data is not stale, only coarsely bucketed. The original "the cost API only reports completed days, so we compute our own" rationale justifies the computation for **one day**, not the whole reporting path.

Also recorded: the calibration ratio in `estimate-today.ts` was absorbing the pricing bug — roughly 0.66 over the last complete week, silently scaling the estimate down by a third. After the price-table fix it should approach 1.0, making it a usable health signal (D8).

## D4. Apportionment for multi-owner workspaces

**Decision**: Distribute a shared workspace's billed total across owners in proportion to their computed cost for the same day, using largest-remainder so parts sum exactly.

**Rationale**: `cost_report` offers no `api_key_id` grouping, so sub-workspace attribution is impossible from billed data. Apportioning a _known total_ bounds the error by the workspace — unlike today, where a per-user estimate can exceed the entire workspace bill by 7×.

Weight by computed cost rather than raw tokens: computed cost already weights models and token types against each other, while raw tokens over-weight cheap cache reads.

## D5. Pricing model on the tier, not the tool

**Decision**: Add `pricing_model` (`seat` | `usage`) to `access_tiers`, defaulting to `seat`.

**Rationale**: the tier is where the price lives, and a tool could plausibly offer both shapes (a seat tier and a metered tier) in future. Defaulting to `seat` makes the migration a no-op for every existing tier except the five `Claude Console` tiers, which are flipped explicitly by id in the data migration.

**Rejected**: putting it on `ai_tools` — coarser, and the price it qualifies is not on that table.

**Evidence for the split being real** (September 2026 budget period):

| Line                                               | Amount  |
| -------------------------------------------------- | ------- |
| `planned`                                          | $17,775 |
| `expected` (Σ tier prices)                         | $14,858 |
| of which `Claude Console` tiers                    | $3,650  |
| measured Claude API consumption (August, complete) | $398.69 |

## D6. Keep `monthly_cost_cents`; change its label, not its name

**Decision**: The column stays. The pricing model decides how it is _labelled_ and _used_, not what it is called.

**Rationale**: `monthlyCostCents` and `costAtAssignmentCents` appear in ~30 places across actions, dialogs, reports and the licence register. Renaming them would produce a large, risky diff that changes no behaviour, competing for review attention with the parts that do. A tier with `pricing_model = 'usage'` renders as "monthly allowance" and feeds the allowance path; the storage is untouched.

`cost_at_assignment_cents` likewise keeps its name and its job — it remains the allowance snapshot at assignment time for usage tiers, which is exactly what the mismatch check in D9 compares against.

## D7. Expected spend for usage tiers: measured, then projected, then allowance

**Decision**: completed period → measured consumption; current/future period → trailing 3-complete-month mean; no history → the allowance, marked as a fallback.

**Rationale**: a completed period has a right answer and should use it. A future period has no measurement, and the allowance is a poor predictor (it over-forecasts ~10× on current data) while recent consumption is a decent one. The fallback exists so a newly assigned user is not forecast at zero.

**Alternatives considered**:

- _Last completed month only._ More responsive, noisier — a single heavy month would dominate the rest of the year. Recorded as spec OQ-2 because the budget owner may prefer it.
- _Allowance as a ceiling on the projection._ Rejected — the allowance is not enforced by the Hub (D10), so treating it as a ceiling would under-forecast a genuine overspend, which is the case most worth seeing.

## D8. Reconciliation as a sync-time check

**Decision**: On each cost sync compare billed against attributed-computed per workspace-month, emit a warning `sync_event` beyond tolerance, and warn on any model missing from the price table.

**Rationale**: the original defect was detectable from data the Hub already had — `pricing_resolved = false` was set on every affected row and surfaced in API payloads, but nothing acted on it. A flag nobody reads is not a control. `sync_events` already has warning semantics and an admin surface.

**Tolerance**: start at 5% or 500 cents per workspace-month, whichever is larger, then tune. Apportionment rounding cannot exceed a few cents.

## D9. Credits: purchases are cash, consumption is cost

**Decision**: An invoice for a `usage` tool is recordable as a credit purchase. Period **cost** for such a tool is measured consumption; purchases are tracked separately, and a balance is derived as opening + purchases − consumption.

**Evidence and rationale**: Anthropic API access is prepaid — the organisation buys a dollar amount, consumption draws it down, and a bill arrives on top-up. Linking those invoices into `billed_costs` as period spend makes a top-up month look expensive and the following months look free. The two events are on unrelated dates and must not be summed.

The Hub can derive the balance even though the Admin API cannot supply it (D10). That turns a known gap — `org-credits-panel.tsx` currently reads "Credit balance is not exposed by the Anthropic API — view in console" — into a number, at the cost of depending on an admin-entered opening balance. Hence FR-016: with no opening balance the answer is "unavailable", never a number derived from an assumed zero.

**Rejected**: inferring credit purchases automatically from invoice amounts or vendor. Too fragile — a seat invoice and a top-up are both "Anthropic, PBC". An explicit mark by the person who files the invoice is the honest mechanism.

## D10. Limits are mirrored, never enforced

**Decision**: The Hub records the cap an admin has set in the Claude Console, with a last-confirmed date, and reports against it. It never sets, enforces or implies enforcement.

**Evidence**: the Anthropic Admin API reference exposes organisation info, API keys, external keys (CMEK) and federation — and **no** endpoint for workspace spend limits or credit balance. There is nothing to read and nothing to write, so a mirror is the only honest model. This also matches the stated operating reality: caps are set in the Console; the Hub is for tracking.

Consequences the design must carry: a recorded cap can silently drift from the real one (hence the last-confirmed date, surfaced in the UI), and "no cap recorded" must be distinguishable from "no cap" and from zero (FR-020) — today no live `Indie -` workspace has any cap recorded, while 10 of the 12 dead `boost-*` workspaces do.

The allowance-vs-cap mismatch flag (FR-019) exists because those are two independently maintained numbers for the same intent — the licence register says $125, the Console says whatever was typed there — and nothing currently compares them.

## D11. Deprecate rather than delete the pooled workspaces

**Decision**: Add a deprecation flag; exclude from listings, cap aggregates and alerting; keep historical cost rows.

**Evidence**: 12 `boost-*` workspaces, ~$4,700/month of recorded caps, $0.00 of current spend — but real spend earlier in 2026 (the 12-month history peaks at $3,500 in May). Deleting would falsify history.

**Rejected**: reusing `is_archived` — it mirrors Anthropic's own state and is overwritten by every workspace sync. Hub-side deprecation is an editorial decision and needs its own column.

## D12. Backward-compatible API evolution

**Decision**: Add attribution fields alongside existing ones; do not rename or repurpose `monthlyTotalCents`, `costCents` or `dailyBreakdown`.

**Rationale**: the profile API is documented in docs/profile-api-integration-guide.md and consumed outside this repository. The values change — that is the point — but the names and meanings must not. Consumers ignoring the new fields keep working and simply get better numbers.

## D13. Historical restatement is in scope, and is a visible event

**Decision**: Backfill line items as far as `cost_report` allows, restate historical per-user figures, and record the restatement.

**Rationale**: leaving history on the inflated basis means reporting a discontinuity the Hub cannot explain. Restating is honest but not invisible — Oliver's August moves from $174.94 to $19.30, and saved forecast scenarios (feature 041), budget periods and reports move with it. Two lines restate at once here: per-user cost (D1) and expected spend (D7). Both belong in one announcement.
