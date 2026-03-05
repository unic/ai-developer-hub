# Contract: Server Actions — Rich Visual Reports

**Feature**: 005-rich-reports | **Date**: 2026-03-05

This document defines the interface contracts for all new Server Action functions
and the pure utility module introduced by this feature.

---

## New Server Action Functions

### `getBilledCostsTimeSeries(budgetId: number)`

**File**: `src/actions/budget.ts`
**Type**: Read function (no `revalidatePath`, no auth restriction beyond session)
**Returns**: `PeriodSpendPoint[]`

```typescript
interface PeriodSpendPoint {
  month: string;          // budgetPeriods.period_label, e.g. "Jan 2026"
  billedCents: number;    // SUM(billed_costs.amount_cents) for this period — integer
  expectedCents: number;  // SUM(active license cost_at_assignment_cents) overlapping period — integer
  plannedCents: number;   // budgetPeriods.planned_amount_cents — integer
  periodIndex: number;    // budgetPeriods.period_index — for client-side sort verification
}

function getBilledCostsTimeSeries(budgetId: number): Promise<PeriodSpendPoint[]>
```

**Behaviour**:
- Returns all periods for the given budget, ordered by `period_index` ascending.
- Periods with no billed costs return `billedCents: 0` (not omitted).
- `expectedCents` is computed the same way as the existing `getExpectedSpendForPeriod()` — sum of `cost_at_assignment_cents` for active assignments overlapping the period date range.
- Returns `[]` if `budgetId` does not exist.

**Error handling**: Returns `[]` on DB error (non-throwing read function, consistent with existing read actions).

---

### `getLicenseUtilizationByTool()`

**File**: `src/actions/assignments.ts`
**Type**: Read function
**Returns**: `ToolUtilization[]`

```typescript
interface ToolUtilization {
  toolId: number;
  toolName: string;
  vendor: string;
  assignedCount: number;          // COUNT of active license_assignments per tool
  maxLicenses: number | null;     // ai_tools.max_licenses — null = unlimited
  utilizationPct: number;         // (assignedCount / maxLicenses) * 100; 0 if maxLicenses is null
  expectedMonthlyCents: number;   // SUM(cost_at_assignment_cents) for active assignments
}

function getLicenseUtilizationByTool(): Promise<ToolUtilization[]>
```

**Behaviour**:
- Includes all `active` tools, even those with zero active assignments (`assignedCount: 0`).
- Pre-sorted by `expectedMonthlyCents` descending.
- `utilizationPct` is a plain number (0–100+); values over 100 indicate over-assignment relative to `maxLicenses`.
- Tools with `maxLicenses = null` receive `utilizationPct: 0`.

**Error handling**: Returns `[]` on DB error.

---

### `getBudgetForecast(budgetId: number)`

**File**: `src/actions/budget.ts`
**Type**: Read function
**Returns**: `ActionResult<BudgetForecast>`

```typescript
// See src/lib/forecast.ts for full BudgetForecast type definition
type BudgetForecastResult =
  | { success: true; data: BudgetForecast }
  | { success: false; error: string }

function getBudgetForecast(budgetId: number): Promise<BudgetForecastResult>
```

**Behaviour**:
- Loads budget + all periods with billed costs via `getBudgetWithCosts(budgetId)`.
- Filters to completed periods (`endDate < today` AND `billedTotalCents > 0`) for the OLS input.
- Computes `actualSpendToDateCents` as the sum of all completed period billed totals.
- Passes data to `forecastBudget()` from `src/lib/forecast.ts`.
- `monthsToProject` is derived from how many months remain in the fiscal year (clamped to 3–6).
- Returns `{ success: false, error: "Budget not found" }` if the budget does not exist.
- Returns `{ success: true, data: { ..., insufficientData: "..." } }` when history has fewer than 3 months — the caller must check `data.insufficientData` to decide whether to show the empty state.

---

## Pure Utility Module

### `forecastBudget(options: ForecastOptions): BudgetForecast`

**File**: `src/lib/forecast.ts`
**Type**: Pure function — no DB access, no side effects, server-only (no `"use client"`)

```typescript
interface ForecastOptions {
  history: MonthlySpend[];          // chronological, max 12 entries
  monthsToProject?: number;         // default 3, clamped to [3, 6]
  actualSpendToDateCents: number;   // integer cents
  budgetCeilingCents: number;       // integer cents from annual_budgets.total_amount_cents
  today: Date;                      // injected for testability
}

interface MonthlySpend {
  month: string;        // "MMM YYYY" format, e.g. "Jan 2026"
  amountCents: number;  // integer
}

interface ForecastPoint {
  month: string;                  // "MMM YYYY" format
  projectedAmountCents: number;   // integer, floored at 0
}

interface BudgetForecast {
  slopeCents: number;
  interceptCents: number;
  projections: ForecastPoint[];
  projectedRemainingCents: number;
  actualSpendToDateCents: number;
  projectedAnnualTotalCents: number;
  budgetCeilingCents: number;
  status: "on_track" | "at_risk";
  insufficientData?: string;      // present when history.length < 3
}
```

**Guarantees**:
- All returned monetary values are integers (Math.round applied to regression output).
- Projected values are never negative (floored at 0).
- When `history.length < 3`, returns without running regression; `projections` is `[]`.
- Pure OLS: x = month index (0-based), y = amountCents.

---

## URL Contract

**Route**: `/reports`
**Tab state via query parameter**: `?tab=<value>`

| Query value | Active tab | Notes |
|-------------|-----------|-------|
| (absent) | Overview | Default; clean URL |
| `?tab=overview` | Overview | Normalized to absent on next navigation |
| `?tab=trends` | Trends | |
| `?tab=usage` | Usage | |
| `?tab=forecast` | Forecast | |
| `?tab=<anything else>` | Overview | Invalid values coerce to default |

**Navigation method**: `router.replace(pathname + queryString, { scroll: false })`
**History behavior**: Tab switches do not create new browser history entries (uses `replace`, not `push`).
**Refresh behavior**: URL is preserved; Server Component re-reads `searchParams` and activates the correct tab.

---

## Component Props Contract

The Server Component assembles all data and passes it to the client tab bar as typed props:

```typescript
// src/app/reports/reports-tab-bar.tsx
interface ReportsTabBarProps {
  activeTab: "overview" | "trends" | "usage" | "forecast";
  overviewData: ReportOverviewData;
  trendsData: PeriodSpendPoint[];           // full history; client filters by range
  usageData: ToolUtilization[];             // all tools; client renders top 10 by default
  forecastData: BudgetForecast | null;      // null if no active budget
}
```

**Serialization constraint**: All props must be JSON-serializable (no `Date` objects, no functions). The `today` date used for forecast computation is the server's `new Date()` — only the resulting `BudgetForecast` record (with string month labels) is passed to the client.
