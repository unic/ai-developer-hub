# Contract: Cost Attribution

**Feature**: 045-usage-based-cost-model | **Date**: 2026-09-18

The normative rules for turning billed workspace cost into per-user cost, and the response shape every consumer receives.

Companion to [pricing-and-credits.md](./pricing-and-credits.md), which covers what a tier price means, expected spend, credit purchases and recorded workspace caps.

## 1. Attribution mode (per workspace)

Derived from the count of rows in `anthropic_workspace_owners` for the workspace. A `manual` row supersedes a `resolved` row for the same (workspace, user).

| Owners    | Mode           | Meaning                                                         |
| --------- | -------------- | --------------------------------------------------------------- |
| exactly 1 | `billed`       | The workspace's billed cost is that user's cost, unmodified     |
| 2 or more | `apportioned`  | Billed cost is distributed across owners by computed-cost share |
| 0         | `unattributed` | Cost belongs to no user; stays in org totals only               |

## 2. Per-user daily cost

For a user `u`, workspace `w`, date `d`:

```
if d is the current UTC day:
    cost = computed_cost_cents(u, d)              method = "estimated"

else if mode(w) == "billed":
    cost = billed_cost_cents(w, d)                method = "billed"

else if mode(w) == "apportioned":
    cost = apportion(billed_cost_cents(w, d),
                     weights = computed_cost_cents(owner, d) for each owner)
                                                  method = "apportioned"

else:  # unattributed
    the user has no cost from w on d
```

**Rules**

- **R1** — A user's cost for a complete day NEVER comes from the price table when their workspace is in `billed` mode. Model breakdowns for that day come from `anthropic_workspace_cost_items`, not from recomputation.
- **R2** — Apportioned parts MUST sum exactly to the workspace's billed cost for the day. Use largest-remainder: compute floor shares, then hand out remaining cents one at a time to the largest fractional remainders, ties broken by ascending `user_id` for determinism.
- **R3** — If every owner's weight for a day is zero but the workspace has billed cost, split evenly by the same largest-remainder rule. (Happens when billed cost exists with no matching usage rows — e.g. a cost type the usage report does not cover.)
- **R4** — Cost from an `unattributed` workspace is NEVER assigned to a user, including the workspace's own resolved-but-since-removed owners.
- **R5** — A period is never mixed: for a month-to-date figure, complete days use their stored attribution and the current day uses the estimate. The two are summed, and the response reports the mix (§4).

## 3. Rounding

All arithmetic is in integer cents. `cost_report` returns `amount` as a decimal string of cents (e.g. `"123.45"`); it is rounded to the nearest cent on ingestion, matching the existing `Math.round(parseFloat(r.amount))`. No floating-point value is ever persisted or summed.

## 4. Response contract

### 4.1 Profile API — `GET /api/profile`

**Unchanged** (FR-012, SC-008). Existing consumers read these and MUST keep working:

| Field                                                          | Behaviour                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `costData.monthlyTotalCents`                                   | Same name, same meaning. Value now billed-based for complete days                  |
| `costData.dailyBreakdown[].totalCents`                         | Same                                                                               |
| `costData.dailyBreakdown[].models[]`                           | Same shape. For `billed` days, sourced from cost line items rather than recomputed |
| `costData.available`, `latestDataDate`, `hasUnresolvedPricing` | Unchanged                                                                          |

**Added**:

| Field                                 | Type                                                  | Meaning                                                                     |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `costData.attribution.method`         | `"billed" \| "apportioned" \| "estimated" \| "mixed"` | Dominant method for the period; `mixed` when the period spans more than one |
| `costData.attribution.billedCents`    | number                                                | Portion from billed/apportioned complete days                               |
| `costData.attribution.estimatedCents` | number                                                | Portion from the current-day estimate                                       |
| `costData.attribution.workspaceId`    | string \| null                                        | Workspace the figure came from                                              |
| `costData.dailyBreakdown[].method`    | `"billed" \| "apportioned" \| "estimated"`            | Per-day method                                                              |

`hasUnresolvedPricing` keeps its meaning but loses most of its significance: it can only be true for days that are still estimated. It is retained for compatibility.

### 4.2 MCP tools

`get_user_cost_profile` and `get_claude_spend_summary` gain the same `attribution` object. `list_claude_users` gains a per-user `attributionMethod`. No existing field is renamed or removed.

### 4.3 UI

Every surface showing a Claude cost figure displays its method. Text, not colour alone (constitution IV). Suggested wording:

- `billed` — no badge; this is the expected state and badging it everywhere is noise
- `apportioned` — "apportioned" badge, tooltip naming the shared workspace and the co-owners
- `estimated` — "estimate" badge, tooltip naming the reason (current day, or no cost data for the period)

## 5. Reconciliation contract

Per workspace and complete-day range, the cost sync compares:

```
billed    = SUM(anthropic_workspace_costs.cost_cents)
attributed = SUM(anthropic_usage_metrics.computed_cost_cents) for that workspace's owners
```

A warning `sync_event` is recorded when `abs(billed - attributed) > max(500, billed * 0.05)`.

The event message MUST name the workspace, the period, both figures and the ratio. Rationale in research.md D6; the tolerance is a starting value to be tuned against observed noise.

Separately, the usage sync records a warning naming any model string absent from the price table. Unlike today's `pricing_resolved` flag, this is an event an admin sees, not a field on a payload.

## 6. Invariants

These must hold after every sync and are the basis for the integration tests:

- **I1** — For any complete day, the sum of all users' attributed cost plus all unattributed workspace cost equals the org's total billed cost for that day.
- **I2** — No user's attributed cost for a day exceeds their workspace's billed cost for that day.
- **I3** — A workspace in `billed` mode has exactly one user whose attributed cost equals its billed cost.
- **I4** — Changing ownership changes subsequent cost reads without any Anthropic API call.
- **I5** — Deprecating a workspace changes no cost figure, only its presence in listings and alerting.
