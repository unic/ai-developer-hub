# Data Model: Rich Visual Reports

**Feature**: 005-rich-reports | **Date**: 2026-03-05

## Schema Changes

**None.** All report data is derived from existing tables. No migrations required.

## Existing Tables Used

### `annual_budgets`
Used by: Overview (budget ceiling), Forecast (ceiling for on-track/at-risk)

| Column | Type | Usage |
|--------|------|-------|
| `id` | integer PK | Lookup key |
| `fiscal_year` | integer | Display label |
| `total_amount_cents` | integer | Budget ceiling for forecast and overview |
| `period_type` | enum `monthly\|quarterly` | Determines period granularity |
| `status` | enum `active\|archived` | Filter for active budget |

### `budget_periods`
Used by: Trends (time-series x-axis), Forecast (history baseline)

| Column | Type | Usage |
|--------|------|-------|
| `id` | integer PK | Join key to `billed_costs` |
| `budget_id` | integer FK | Links to `annual_budgets` |
| `period_label` | varchar(20) | Human-readable label (e.g. "Jan 2026") — used as chart x-axis tick |
| `period_index` | integer | Sort order for chronological display |
| `start_date` | date | Used to compute `expectedSpendCents` via assignment overlap |
| `end_date` | date | Used to determine completed periods for forecast baseline |
| `planned_amount_cents` | integer | Optional planned budget per period (displayed on Trends chart) |

### `billed_costs`
Used by: Trends (actual spend line), Forecast (OLS input), Overview (YTD billed total)

| Column | Type | Usage |
|--------|------|-------|
| `id` | integer PK | — |
| `period_id` | integer FK | Groups costs by budget period |
| `amount_cents` | integer | Actual invoiced amount (aggregated per period for charts) |
| `invoice_date` | date | Could be used for daily granularity if needed |
| `description` | varchar(500) | Not used in charts |

### `license_assignments`
Used by: Overview (active license count), Usage (assigned seats per tool), Trends (expected spend)

| Column | Type | Usage |
|--------|------|-------|
| `tool_id` | integer FK | Group by tool for utilization |
| `status` | enum `active\|inactive` | Filter for active assignments |
| `cost_at_assignment_cents` | integer | Per-assignment monthly cost (sum → expected spend) |
| `assigned_at` | timestamp | Could be used for assignment trend over time |
| `revoked_at` | timestamp | Marks end of active period |

### `ai_tools`
Used by: Usage (utilization denominator), Trends (per-tool spend breakdown optional)

| Column | Type | Usage |
|--------|------|-------|
| `id` | integer PK | Join key |
| `name` | varchar(255) | Chart label |
| `vendor` | varchar(255) | Optional grouping |
| `max_licenses` | integer | Seat capacity — utilization denominator (may be null for unlimited) |
| `status` | enum `active\|archived` | Filter active tools for usage report |

---

## New Computed Data Shapes (TypeScript Interfaces)

These types are produced by new Server Action functions and consumed by chart components. They live in `src/types/index.ts` (alongside existing types) or are exported directly from the action files.

### `PeriodSpendPoint`
Output of `getBilledCostsTimeSeries()` — one entry per budget period.

```typescript
interface PeriodSpendPoint {
  month: string;          // e.g. "Jan 2026" — from budgetPeriods.periodLabel
  billedCents: number;    // sum of billedCosts.amount_cents for this period (integer)
  expectedCents: number;  // sum of active assignment costs overlapping this period (integer)
  plannedCents: number;   // budgetPeriods.planned_amount_cents (integer)
  periodIndex: number;    // budgetPeriods.period_index — for sorting
}
```

**Aggregation rule**: For monthly period type, one `PeriodSpendPoint` per period. For quarterly, one per quarter. The granularity selector on the Trends tab filters this array client-side (slicing the last N months).

### `ToolUtilization`
Output of `getLicenseUtilizationByTool()` — one entry per active tool.

```typescript
interface ToolUtilization {
  toolId: number;
  toolName: string;
  vendor: string;
  assignedCount: number;    // count of active license_assignments for this tool
  maxLicenses: number | null; // ai_tools.max_licenses — null means unlimited
  utilizationPct: number;   // (assignedCount / maxLicenses) * 100, null-safe (0 if maxLicenses is null)
  expectedMonthlyCents: number; // sum of cost_at_assignment_cents for active assignments
}
```

**Sorting**: Returned pre-sorted by `expectedMonthlyCents` descending (highest-cost tools first). The Usage tab default view shows the top 10; the "show all" toggle renders the full array.

### `BudgetForecast`
Output of `getBudgetForecast()` — full forecast result including OLS coefficients and projected points.

```typescript
interface MonthlySpend {
  month: string;        // e.g. "Jan 2026"
  amountCents: number;  // integer cents
}

interface ForecastPoint {
  month: string;                  // e.g. "Apr 2026"
  projectedAmountCents: number;   // integer cents, floored at 0
}

interface BudgetForecast {
  slopeCents: number;                       // OLS slope in cents/month (rounded integer)
  interceptCents: number;                   // OLS intercept at x=0 (rounded integer)
  projections: ForecastPoint[];             // 3–6 projected months
  projectedRemainingCents: number;          // sum of projections (integer)
  actualSpendToDateCents: number;           // sum of billed costs in completed periods (integer)
  projectedAnnualTotalCents: number;        // actualSpendToDateCents + projectedRemainingCents
  budgetCeilingCents: number;               // annual_budgets.total_amount_cents
  status: "on_track" | "at_risk";
  insufficientData?: string;                // present if history.length < 3
}
```

### `ReportOverviewData`
Aggregated from multiple sources for the Overview tab summary cards.

```typescript
interface ReportOverviewData {
  totalActiveUsers: number;
  totalActiveTools: number;
  totalActiveLicenses: number;
  expectedMonthlyCents: number;   // sum of active assignment costs
  billedYtdCents: number;         // sum of all billed costs in current fiscal year
  budgetCeilingCents: number;     // annual_budgets.total_amount_cents (0 if no active budget)
  budgetRemainingCents: number;   // budgetCeilingCents - billedYtdCents (may be negative)
  utilizationPct: number;         // (billedYtdCents / budgetCeilingCents) * 100
  // Trend indicators: current period vs. prior period
  spendTrend: "up" | "down" | "flat";
  spendTrendPct: number;          // percentage change vs. prior period (signed)
}
```

### `ForecastChartPoint`
Merged data shape for the composite forecast chart (historical + projected on same x-axis).

```typescript
interface ForecastChartPoint {
  month: string;
  historical: number | null;   // billedCents — null for future months
  projected: number | null;    // projectedAmountCents — null for past months (except last historical)
}
```

**Construction rule**: The last historical month has both `historical` and `projected` values set to visually connect the two lines. All future months have `historical: null`.

---

## Data Flow Diagram

```
Database Tables               Server Actions              Chart Components
─────────────────             ──────────────              ────────────────
annual_budgets ─────────────► getActiveBudget()    ──►   Overview cards
                              getBudgetForecast()  ──►   Forecast chart
budget_periods ──────────────►
billed_costs ────────────────► getBilledCostsTimeSeries() ──► Trends chart
                                                          ──► Forecast (history)
license_assignments ─────────►
                              getLicenseUtilizationByTool() ──► Usage chart
ai_tools ────────────────────►                            ──► Usage table

All ──────────────────────────► page.tsx (Server) ──► reports-tab-bar.tsx (Client)
                                                  └──► ReportsChartsPanel (lazy)
```

---

## Constraints

- **Integer cents everywhere**: No floating-point monetary values at any layer. Division by 100 for display only, inside chart formatter callbacks.
- **`maxLicenses` nullable**: Tools with `maxLicenses = null` are treated as "unlimited" — `utilizationPct` is 0 and the bar chart shows only the `assignedCount` with no capacity segment.
- **Active budget assumption**: The reports page fetches `getActiveBudget()` first. If no active budget exists, Forecast and budget-related Overview fields show empty states.
- **Period label format**: `"MMM YYYY"` (e.g. "Jan 2026") is the canonical format used in `budgetPeriods.period_label` and expected by `src/lib/forecast.ts` `parseMonthLabel()`.
