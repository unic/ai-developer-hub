# Data Model: Usage-Based Cost Model

**Feature**: 045-usage-based-cost-model | **Date**: 2026-09-18

One migration (`0032`). Three new tables, five modified, two new enums. No destructive changes — `anthropic_usage_metrics`' existing computation is untouched (FR-027), and no column is renamed (research.md D6).

## New enums

```sql
CREATE TYPE attribution_mode AS ENUM ('billed', 'apportioned', 'unattributed');
CREATE TYPE pricing_model   AS ENUM ('seat', 'usage');
```

`attribution_mode` doubles as the per-figure method marker, with one extra value at the API boundary — `estimated`, for the current day. It is deliberately not a database value: no stored row is `estimated`, because only complete days are stored.

## New table: `anthropic_workspace_cost_items`

Billed cost at line-item grain, from `cost_report` with `group_by[]=workspace_id&group_by[]=description`.

| Column                      | Type              | Notes                                                           |
| --------------------------- | ----------------- | --------------------------------------------------------------- |
| `id`                        | serial PK         |                                                                 |
| `workspace_id`              | varchar(100) NULL | `NULL` = default workspace, matching the existing convention    |
| `date`                      | date NOT NULL     | UTC bucket start                                                |
| `model`                     | varchar(100) NULL | `NULL` for non-token costs                                      |
| `cost_type`                 | varchar(40) NULL  | `tokens` \| `web_search` \| `code_execution` \| `session_usage` |
| `token_type`                | varchar(60) NULL  | e.g. `cache_creation.ephemeral_1h_input_tokens`                 |
| `context_window`            | varchar(20) NULL  | `0-200k` \| `200k-1M`                                           |
| `service_tier`              | varchar(20) NULL  | `standard` \| `batch`                                           |
| `inference_geo`             | varchar(20) NULL  | `global` \| `us` \| `not_available` — **part of the grain**     |
| `cost_microcents`           | bigint NOT NULL   | `CHECK >= 0`. Cents × 10^6 — see Precision below                |
| `created_at` / `updated_at` | timestamp         |                                                                 |

**Indexes**: unique on the full grain — `(workspace_id, date, model, cost_type, token_type, context_window, service_tier, inference_geo)` — using the partial-index pattern `anthropic_workspace_costs` already uses for nullable `workspace_id` (one index `WHERE workspace_id IS NOT NULL`, one `WHERE workspace_id IS NULL`). `NULL`s _inside_ the grain columns will not collide under a plain unique index — use `COALESCE(col,'')` in the index expression, or a generated grain-key column if the expression index is awkward in Drizzle. Plus `(date)` and `(workspace_id, date)`.

**`inference_geo` belongs in the grain, not as decoration.** A live sample shows Haiku 4.5 reporting `not_available` while every other model on the same workspace-day reports `global`. Left out of the unique key, two genuinely different rows would collide and the upsert would silently overwrite one with the other.

### Precision — why micro-cents

`cost_report` returns `amount` as a decimal string **of cents**, with up to six decimal places (`"143.569125"` = $1.4357). Verified against a live sample: the line items for 2026-09-01 sum to 2 927.82 cents, and the Hub's dashboard shows $29.28 for that day.

Rounding each line item to whole cents _before_ summing does not reproduce that total. In the sample it drifts by ±1 cent per workspace-day — small, but enough to break SC-001's "0 cents difference" requirement once 12–14 line items replace the single daily row the sync stores today. The existing `Math.round(parseFloat(r.amount))` is safe only because today there is roughly one row per workspace-day; `group_by[]=description` is what makes it unsafe.

So: **store micro-cents, round once at the aggregate.**

- Ingest: `cost_microcents = Math.round(parseFloat(amount) * 1_000_000)` — exact at six decimal places.
- Roll up: `cost_cents = Math.round(SUM(cost_microcents) / 1_000_000)`, never a sum of pre-rounded parts.
- Attribution follows the same rule: apportion in micro-cents, round each user's share once.

This keeps the constitution's integer-cents rule — micro-cents are integers and no floating-point value is persisted. `anthropic_workspace_costs.cost_cents` stays whole cents, because it is the rounded rollup.

**Relationship to `anthropic_workspace_costs`**: the existing daily table is kept and remains the read path for the org dashboard and cap views, so those surfaces need no change. It becomes _derived_ — the sync writes line items, then upserts the rollup as their sum. The two cannot disagree because one is computed from the other.

## New table: `anthropic_workspace_owners`

The workspace-to-user relationship, promoted from an implicit join on `anthropic_sync_status.resolved_workspace_id`.

| Column                      | Type                 | Notes                                                    |
| --------------------------- | -------------------- | -------------------------------------------------------- |
| `id`                        | serial PK            |                                                          |
| `workspace_id`              | varchar(100) NULL    |                                                          |
| `user_id`                   | integer NOT NULL     | FK → `users.id`, `ON DELETE CASCADE`                     |
| `source`                    | varchar(20) NOT NULL | `resolved` (key resolution) \| `manual` (admin override) |
| `created_at` / `updated_at` | timestamp            |                                                          |

**Indexes**: unique `(workspace_id, user_id)` with the same NULL-workspace partial split; `(user_id)`.

**Population**: seeded in the migration from `anthropic_sync_status` where `resolved_api_key_id IS NOT NULL`; thereafter maintained by `resolveAllMappings()`. A `manual` row wins over a `resolved` row for the same pair and is never overwritten by the sync.

**Attribution mode is derived, not stored**: owner count → 1 = `billed`, >1 = `apportioned`, 0 = `unattributed`. Deriving keeps FR-023 true (an admin correction takes effect on the next read, with no re-sync).

## New table: `credit_purchases`

Prepayments for usage-based tools, kept out of period cost (FR-013/014).

| Column                                     | Type              | Notes                                                               |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------- |
| `id`                                       | serial PK         |                                                                     |
| `tool_id`                                  | integer NOT NULL  | FK → `ai_tools.id`                                                  |
| `invoice_id`                               | integer NULL      | FK → `invoices.id`; null for a purchase recorded without an invoice |
| `purchased_at`                             | date NOT NULL     | Value date of the top-up                                            |
| `amount_cents`                             | integer NOT NULL  | `CHECK > 0`                                                         |
| `note`                                     | varchar(200) NULL |                                                                     |
| `created_at` / `updated_at` / `created_by` |                   | `created_by` FK → `users.id`                                        |

**Indexes**: `(tool_id, purchased_at)`, `(invoice_id)`.

The opening balance lives on the tool (below) rather than as a synthetic purchase row, so "no opening balance recorded" stays distinguishable from "an opening balance of zero" (FR-016).

**Interaction with `billed_costs`**: today an invoice is linked to a `billed_costs` row, which is what the budget sums as period spend. An invoice recorded as a credit purchase must not also count there — either it is not linked to a `billed_costs` row at all, or the period-cost query excludes `billed_costs` rows whose invoice has a `credit_purchases` entry. The contract (contracts/pricing-and-credits.md §3) specifies the exclusion as the rule, so an already-linked invoice can be reclassified without unpicking the link.

## Modified: `access_tiers`

| Column          | Type                                      | Notes |
| --------------- | ----------------------------------------- | ----- |
| `pricing_model` | `pricing_model` NOT NULL DEFAULT `'seat'` | NEW   |

The default makes the migration a no-op for every existing tier. The data migration flips exactly the five `Claude Console` tiers (`indie-profile`, `boost-starter`, `boost-advanced`, `boost-expert`, `boost-leader`) to `usage`, **by explicit tier id**.

`monthly_cost_cents` is unchanged in name, type and storage. For a `usage` tier it means _monthly allowance_ (research.md D6).

## Modified: `ai_tools`

| Column                         | Type         | Notes                                                        |
| ------------------------------ | ------------ | ------------------------------------------------------------ |
| `credit_opening_balance_cents` | integer NULL | NEW. `NULL` = not recorded ⇒ balance reported as unavailable |
| `credit_opening_balance_at`    | date NULL    | NEW. As-of date for the opening balance                      |

## Modified: `anthropic_workspaces`

| Column              | Type              | Notes                                                            |
| ------------------- | ----------------- | ---------------------------------------------------------------- |
| `deprecated_at`     | timestamp NULL    | NEW. Non-null ⇒ excluded from listings, cap aggregates, alerting |
| `deprecated_reason` | varchar(200) NULL | NEW                                                              |

`is_archived` is left alone — it mirrors Anthropic's state and is overwritten by every workspace sync (research.md D11).

## Modified: `anthropic_workspace_limits`

| Column         | Type           | Notes                                                      |
| -------------- | -------------- | ---------------------------------------------------------- |
| `confirmed_at` | timestamp NULL | NEW. When an admin last confirmed this mirrors the Console |
| `confirmed_by` | integer NULL   | NEW. FK → `users.id`                                       |

The table already holds an admin-entered `limit_cents` per workspace. These two columns make drift visible (research.md D10). A row's _absence_ means "no cap recorded" — never "no cap" and never zero (FR-020).

## Modified: `anthropic_usage_metrics`

| Column                  | Type                    | Notes                                                                                                             |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `attributed_cost_cents` | integer NULL            | NEW. Billed or apportioned figure for this user-day-model. `NULL` = not attributed (current day, or no cost data) |
| `attribution_mode`      | `attribution_mode` NULL | NEW. How it was derived                                                                                           |

`computed_cost_cents` and `pricing_resolved` are unchanged and keep their meaning — apportionment weights, current-day estimate, reconciliation input.

**Read rule** for any per-user cost: `COALESCE(attributed_cost_cents, computed_cost_cents)`, reporting `attribution_mode` when present and `estimated` when it falls through. This keeps the swap a one-line change at each of the six consuming query sites.

## Derived read models (no tables)

**`AttributedDailyCost`** — `{ userId, date, costCents, method: "billed" | "apportioned" | "estimated", workspaceId }`.

**`ExpectedSpend`** — `{ periodId, toolId, cents, basis: "tier_price" | "measured" | "projected" | "allowance_fallback" }` (FR-012).

**`CreditBalance`** — `{ toolId, available: boolean, openingCents, purchasedCents, consumedCents, balanceCents, asOf }`; `available: false` when no opening balance is recorded.

**`WorkspaceCapStatus`** — `{ workspaceId, recorded: boolean, capCents, consumedCents, utilizationPct, confirmedAt, allowanceSumCents, mismatch: boolean }`.

## Migration ordering

1. Create the two enums, then the three tables (`anthropic_workspace_owners` and `credit_purchases` have FKs to `users` / `ai_tools` / `invoices`).
2. Add the new columns to `access_tiers`, `ai_tools`, `anthropic_workspaces`, `anthropic_workspace_limits`, `anthropic_usage_metrics` — all nullable or defaulted, no table rewrite.
3. Seed `anthropic_workspace_owners` from `anthropic_sync_status`.
4. Flip the five `Claude Console` tiers to `pricing_model = 'usage'` by explicit id.
5. Mark the 12 `boost-*` workspaces deprecated by explicit workspace id — not a `LIKE` pattern, which could catch a future workspace.

Every step is additive; rollback is dropping the new objects and columns. No existing read path breaks at any point, which is what lets the read-path swap ship incrementally.

## Volume estimate

Measured from a live sample rather than estimated: **36–38 line items per day org-wide** (3–4 active workspaces × 12–14 rows each) ≈ **1.1k rows/month, ~13k/year** — an order of magnitude below the earlier estimate, because only a handful of workspaces are active on any given day. No partitioning needed, and the backfill is small enough that `maxDuration = 300` is no longer in doubt. `credit_purchases` grows by a handful of rows a month.
