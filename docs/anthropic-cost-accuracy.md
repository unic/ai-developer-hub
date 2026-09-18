# Why AI Hub Claude API costs drifted from the Claude Console

Investigation, 2026-09-18.

## Summary

The AI Hub keeps **two** independent Claude cost figures:

| Figure                     | Source                                                                                  | Stored in                                     | Used by                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Actual billed cost**     | Anthropic `GET /v1/organizations/cost_report`                                           | `anthropic_workspace_costs`                   | `/claude` org dashboard, workspace pages, budget caps                                                    |
| **Computed per-user cost** | `usage_report` token counts × a hard-coded price table (`src/lib/anthropic-pricing.ts`) | `anthropic_usage_metrics.computed_cost_cents` | Per-user pages, **the profile API and MCP tools other applications consume** (`src/lib/profile-data.ts`) |

Only the first one is authoritative — it is the same number the Console shows.
The second one is an estimate, and it silently went wrong.

**Root cause:** `resolveModelPricing()` prefix-matches the model string against a
hard-coded table. Any model missing from that table falls back to the
**highest tier ever charged — $15/$75 per MTok (Opus 4.0/4.1)** — and is only
marked with `pricing_resolved = false`; nothing alerts on it. The table was last
updated on 2026-06-01 (Opus 4.8). Every model released since then — `claude-sonnet-5`,
`claude-opus-5`, `claude-fable-5`, `claude-fable-5-1` — was being billed at the
Opus 4.0 fallback rate.

The divergence therefore did not start on a particular deploy: **it started per
user, on the first day that user switched to a model missing from the table.**

## Evidence (September 2026, 1–17)

Each "indie" user maps 1:1 to their own Anthropic workspace, so the
`cost_report` figure can be compared directly against the computed figure.

| User                | Actual (cost_report / Console) | AI Hub computed | Ratio     | Models used                                  |
| ------------------- | ------------------------------ | --------------- | --------- | -------------------------------------------- |
| Svenja Haas         | $29.31                         | $29.30          | **1.00×** | all in the price table                       |
| Marlon Schlosshauer | $112.55                        | $183.48         | 1.63×     | mostly Fable 5 / 5.1, some Opus 5 + Sonnet 5 |
| Oliver Ladner       | $32.83                         | $249.32         | **7.59×** | almost entirely Sonnet 5                     |

The user whose models were all in the table matches to the cent. The
overstatement ratios track the fallback exactly:

- Sonnet 5 is $2/$10 but was billed at $15/$75 → **7.5×**
- Opus 5 is $5/$25 but was billed at $15/$75 → **3×**
- Fable 5 / 5.1 are $10/$50 but were billed at $15/$75 → **1.5×**

For Oliver the drift starts on **2026-08-11**, his first day on Sonnet 5:
August computed $174.94 vs. $19.30 actually billed.

## Fix applied

`src/lib/anthropic-pricing.ts`:

1. Added the missing tiers — Fable 5.1 and Fable 5 ($10/$50), Opus 5 ($5/$25),
   Sonnet 5 ($2/$10) — with their cache read/write rates. Fable 5.1 cache reads
   are $0.25/MTok, not the usual 0.1× input.
2. `resolveModelPricing()` now picks the **longest** matching prefix instead of
   the first one in array order, so `claude-fable-5-1` cannot be swallowed by
   `claude-fable-5`.
3. The unknown-model fallback is now the named `FALLBACK_PRICING` constant
   rather than `MODEL_PRICING[0]`, which silently depended on array order.

**After deploying, run `recalculateUnresolvedCosts()`** (admin action). It
re-prices exactly the rows with `pricing_resolved = false`, so it will correct
the historical Sonnet 5 / Opus 5 / Fable rows without touching anything else.

## Residual gaps (not fixed here)

Re-pricing brings Oliver's August from $174.94 to roughly $23, against $19.30
actually billed — closer, but still an estimate. Three known modelling gaps
remain, in rough order of impact:

1. **Cache TTL granularity.** `usage_report` returns
   `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` separately, but
   `prepareUsageRow()` sums them into one `cache_creation_input_tokens` column
   and applies the 5-minute rate. 1-hour cache writes cost 2× input, not 1.25×.
   Fixing this needs a schema change (two columns) plus a resync.
2. **Long-context pricing.** Requests above 200K tokens on the 1M-context models
   are priced higher. `cost_report` exposes a `context_window` dimension that the
   sync currently discards; the token-based computation ignores it entirely.
3. **Batch / service-tier discounts.** Batch requests bill at 50%. Neither the
   token computation nor the current grouping distinguishes service tiers.

## Recommendation

Treat the token-derived number as what it is — an estimate that will drift again
on the next model launch. Two structural improvements:

- **Reconcile automatically.** Add a check that compares
  `SUM(computed_cost_cents)` against `anthropic_workspace_costs` per workspace
  and month, and raises a sync event when they diverge beyond a threshold. Any
  future missing model would then surface within a day instead of a month.
  A `pricing_resolved = false` row appearing in a sync should also be an alert,
  not just a flag on a response payload.
- **Prefer authoritative costs where the mapping allows it.** For users who own
  their workspace 1:1 (the whole "indie" profile), the `cost_report` figure for
  that workspace _is_ their billed cost. Exposing that through the profile API —
  falling back to the token estimate only for shared workspaces — removes the
  estimation error entirely for most users.

Both of these are specified in [`specs/045-workspace-cost-attribution/`](../specs/045-workspace-cost-attribution/spec.md),
which also covers the current-day boundary and retires the dead `boost-*` pooled
workspaces. Attributing project/client workspace spend is deferred to a separate
feature.
