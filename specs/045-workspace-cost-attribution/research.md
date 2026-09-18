# Research: Workspace-Based Claude Cost Attribution

**Feature**: 045-workspace-cost-attribution | **Date**: 2026-09-18

Phase 0 decisions, with the evidence behind each.

## D1. Billed cost as the source of truth for complete days

**Decision**: For complete UTC days, per-user cost is derived from `cost_report`, not from token counts × price table.

**Evidence**: September 2026 (1–17), comparing each single-owner workspace's billed cost with the Hub's computed figure:

| User                | Billed (Console) | Hub computed | Ratio |
| ------------------- | ---------------- | ------------ | ----- |
| Svenja Haas         | $29.31           | $29.30       | 1.00× |
| Marlon Schlosshauer | $112.55          | $183.48      | 1.63× |
| Oliver Ladner       | $32.83           | $249.32      | 7.59× |

The user whose models were all in the price table matched to the cent; the others tracked the fallback rate exactly. Even after the price-table fix, the computed figure remains an approximation: Oliver's August re-prices to roughly $23 against $19.30 actually billed, because the computation still cannot see cache-TTL split, context-window tier or service tier.

**Alternatives considered**:

- _Keep computing, fix the table faster._ Rejected — it makes correctness depend on a human noticing every model launch, which is precisely what failed. It also cannot close the residual ~20% gap.
- _Keep computing, add more pricing dimensions (1h cache, long context, batch)._ Rejected — it is strictly more work than reading the billed number, and still wrong whenever Anthropic changes anything.

## D2. `cost_report` line items instead of a daily total

**Decision**: Call `cost_report` with `group_by[]=workspace_id&group_by[]=description` and store the result at line-item grain.

**Evidence**: with `group_by[]=description`, each result row carries `model`, `token_type` (including `cache_creation.ephemeral_1h_input_tokens` vs `…_5m_…`), `context_window` (`0-200k` / `200k-1M`), `service_tier` (`standard` / `batch`) and `inference_geo`. The current sync discards all of it by summing into one `cost_cents` per workspace-day.

This single change removes all three "residual modelling gaps" recorded in docs/anthropic-cost-accuracy.md — they become data rather than approximations — and gives per-model cost breakdowns for free, which the user detail pages currently synthesise from the price table.

**Cost**: more rows. Order-of-magnitude for the current estate: ~20 workspaces × ~30 days × a handful of models × ~5 token types ≈ low tens of thousands of rows per month, well within Neon's comfort zone with the date index already in place.

## D3. The current day stays an estimate

**Decision**: Keep the token-derived computation for the current UTC day, and keep the existing calibration in `src/lib/anthropic/estimate-today.ts`.

**Evidence**: the Cost API reference lists `bucket_width` as `optional "1d"` — the only accepted value — and returns "time buckets that **end before** `ending_at`". Today's bucket ends at tomorrow's midnight, so it is never returned; the sync's existing comment records that a `now` or future `ending_at` is floored back to start-of-today.

Note what is **no longer** true: the docs FAQ states usage _and cost_ data both appear within ~5 minutes. Cost data is not stale; only its bucketing is coarse. The original "the cost API only reports completed days, so we compute our own" rationale therefore justifies the computation for **one day**, not for the whole reporting path.

Also worth recording: the calibration ratio in `estimate-today.ts` was absorbing the pricing bug — over the last complete week it ran at roughly 0.66, silently scaling the estimate down by a third. After the price-table fix it should approach 1.0, which makes it a usable health signal (D6).

## D4. Apportionment for multi-owner workspaces

**Decision**: Distribute a shared workspace's billed total across its owners in proportion to their computed cost for the same day, with the largest-remainder method so the parts sum exactly to the billed total.

**Rationale**: `cost_report` offers no `api_key_id` grouping, so sub-workspace attribution is impossible from billed data alone. Apportioning a _known total_ bounds the error by the workspace — unlike today, where a per-user estimate can exceed the whole workspace's bill by 7×.

Proportion by computed cost rather than raw tokens because computed cost already weights models and token types against each other; raw token counts would over-weight cheap cache reads.

**Alternatives considered**:

- _Leave shared workspaces on the pure estimate._ Rejected — it preserves the unbounded-error case for exactly the users least likely to notice.
- _Split evenly across owners._ Rejected — indefensible when one owner does 95% of the work.

## D5. Ownership as first-class data with an admin override

**Decision**: Persist workspace ownership (derived from `anthropic_sync_status.resolved_workspace_id`, overridable by an admin) rather than deriving it ad hoc in queries.

**Rationale**: attribution correctness now depends on this mapping, so it needs to be inspectable and correctable. The derivation already exists and is already populated — `resolveAllMappings()` in `src/lib/anthropic-sync.ts` writes `resolved_workspace_id` when it resolves a key, and three read paths already join on it. This decision promotes an existing implicit relationship, it does not invent one.

## D6. Reconciliation as a sync-time check

**Decision**: On each cost sync, compare billed versus attributed-computed cost per workspace-month and emit a warning `sync_event` beyond a tolerance; also warn on any model missing from the price table.

**Rationale**: the original defect was detectable from data the Hub already had — `pricing_resolved = false` was set on every affected row and surfaced in API payloads, but nothing acted on it. A flag nobody reads is not a control. `sync_events` already exists with error/warning semantics and an admin surface.

**Tolerance**: start at 5% or 500 cents per workspace-month, whichever is larger, and tune. Apportionment rounding cannot exceed a few cents; anything larger is a real signal.

## D7. Deprecate rather than delete the pooled workspaces

**Decision**: Add a deprecation flag; exclude deprecated workspaces from listings, cap aggregates and alerting; keep their historical cost rows.

**Evidence**: 12 `boost-*` workspaces hold ~$4,700/month of configured caps and $0.00 of current spend. They did carry real spend earlier in 2026 (the 12-month history peaks at $3,500 in May), so deleting them would falsify history.

**Alternatives considered**:

- _Delete the workspaces and their rows._ Rejected — destroys historical reporting for Feb–Jun 2026.
- _Archive via the existing `is_archived` flag._ Rejected as the primary mechanism — `is_archived` mirrors Anthropic's own archival state and is overwritten by every workspace sync. Hub-side deprecation is a separate editorial decision and needs its own column.

## D8. Backward-compatible API evolution

**Decision**: Add attribution fields alongside existing ones; do not rename or repurpose `monthlyTotalCents`, `costCents` or `dailyBreakdown`.

**Rationale**: the profile API is documented in docs/profile-api-integration-guide.md and consumed by applications outside this repository. The values those fields carry will change (that is the point), but their names and meaning must not. Consumers that ignore the new fields keep working and simply get better numbers.

## D9. Historical restatement is in scope, and is a visible event

**Decision**: Backfill line items as far as `cost_report` allows and restate historical per-user figures, recording the restatement.

**Rationale**: leaving history on the inflated basis means the Hub reports a discontinuity it cannot explain. Restating is the honest option, but it is not invisible — Oliver's August moves from $174.94 to $19.30, and anything derived from these numbers (saved forecast scenarios from feature 041, budget periods, reports) moves with it. Users will notice; the restatement must therefore be announced rather than discovered.
