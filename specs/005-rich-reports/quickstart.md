# Quickstart: Rich Visual Reports (005-rich-reports)

**Branch**: `005-rich-reports` | **Date**: 2026-03-05

## Prerequisites

- Node.js LTS + pnpm installed
- Neon PostgreSQL connection string in `.env.local` (copy from `.env.example`)
- Existing database seeded (previous features 001–004 must be applied)

## Setup

```bash
# Install dependencies (already installed if working on the main repo)
pnpm install

# Ensure DB schema is current (no new migrations for this feature)
pnpm db:push

# Start dev server
pnpm dev
```

Navigate to `http://localhost:3000/reports` — you should see the existing Reports page (4 summary cards + tables). This feature adds tabs above that content.

## What Gets Built

### New Files

| File | Purpose |
|------|---------|
| `src/lib/forecast.ts` | Pure OLS linear regression utility |
| `src/app/reports/reports-tab-bar.tsx` | Client tab navigation component |
| `src/components/reports/reports-charts-panel.tsx` | Lazy-loaded chart bundle boundary |
| `src/components/reports/trends-chart.tsx` | Time-series line chart |
| `src/components/reports/utilization-chart.tsx` | Stacked horizontal bar chart |
| `src/components/reports/forecast-chart.tsx` | Composite forecast line chart |
| `src/components/reports/sparkline.tsx` | Inline mini trend chart for cards |

### Modified Files

| File | Change |
|------|--------|
| `src/app/reports/page.tsx` | Add `searchParams`, 3 new data fetches, pass props to `ReportsTabBar` |
| `src/app/reports/loading.tsx` | Add chart-shaped skeleton placeholders |
| `src/actions/budget.ts` | Add `getBilledCostsTimeSeries()`, `getBudgetForecast()` |
| `src/actions/assignments.ts` | Add `getLicenseUtilizationByTool()` |

## Development Order (Task Sequence)

1. **`src/lib/forecast.ts`** — Write and unit-test the OLS module first (pure function, no deps).
2. **New Server Actions** — `getBilledCostsTimeSeries`, `getLicenseUtilizationByTool`, `getBudgetForecast`.
3. **`src/app/reports/page.tsx`** — Update to read `searchParams`, call new actions, assemble `ReportsTabBarProps`.
4. **`src/app/reports/reports-tab-bar.tsx`** — Client tab bar with URL routing; verify tab switching works with mock data.
5. **Chart components** — Build each chart in isolation (`trends-chart.tsx`, `utilization-chart.tsx`, `forecast-chart.tsx`, `sparkline.tsx`).
6. **`src/components/reports/reports-charts-panel.tsx`** — Assemble charts + lazy-load boundary.
7. **`src/app/reports/loading.tsx`** — Update with chart-shaped skeletons.
8. **Tests** — Vitest unit tests for `forecast.ts`; Playwright E2E for tab navigation.

## Testing

### Unit Tests (Vitest)

```bash
pnpm test
```

Key test file: `tests/unit/forecast.test.ts`

Test cases to cover:
- OLS with valid 12-month history → correct slope, intercept, projections
- `history.length < 3` → `insufficientData` returned, no projections
- All-zero history → all projections are 0
- Negative projected values → floored at 0
- `status: "on_track"` when `projectedAnnualTotal <= ceiling`
- `status: "at_risk"` when `projectedAnnualTotal > ceiling`

### E2E Tests (Playwright)

```bash
pnpm test:e2e
```

Key E2E scenarios:
- Navigate to `/reports` → Overview tab active by default
- Click "Trends" → URL changes to `?tab=trends`, chart is visible
- Refresh at `?tab=usage` → Usage tab remains active
- Invalid tab param (`?tab=bogus`) → falls back to Overview
- Time range selector in Trends → chart updates without full page reload

### Type Check

```bash
pnpm typecheck
```

No `any` types should be introduced. All chart `data` arrays must be typed against the interfaces in `data-model.md`.

### Linting

```bash
pnpm lint
```

## Seeding Test Data

The Forecast tab requires at least 3 months of completed `budget_periods` with `billed_costs` entries. If the dev database lacks this, use the seed script or manually insert:

```sql
-- Quick check: how many completed periods with billed costs exist?
SELECT bp.period_label, SUM(bc.amount_cents) as billed_total
FROM budget_periods bp
JOIN billed_costs bc ON bc.period_id = bp.id
WHERE bp.end_date < NOW()
GROUP BY bp.id, bp.period_label
ORDER BY bp.period_index;
```

If fewer than 3 rows are returned, the Forecast tab will show the "insufficient data" state (this is valid behavior — not a bug).

## Lighthouse

```bash
pnpm lighthouse
```

The `/reports` route must maintain:
- LCP < 2.5s (charts lazy-load after initial paint — skeleton shows first)
- INP < 200ms (tab switching uses `router.replace` — React reconciliation, not full render)
- CLS < 0.1 (skeleton heights match chart `className` heights to prevent layout shift)
- JS bundle per route < 150 KB gzip (Recharts ~80 KB lazy-loaded separately from main bundle)

## Key Implementation Notes

### Money formatting
Never pass fractional values to charts. Always pass integer cents and format in Recharts `tickFormatter`/`formatter` callbacks:
```tsx
tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
```

### Recharts + Server Components
Never import `recharts` or chart component files in Server Components. All chart imports go through `reports-charts-panel.tsx` which is loaded via `next/dynamic({ ssr: false })`.

### ChartContainer colors
Use `var(--chart-1)` through `var(--chart-5)` for data series colors. Use `var(--color-<key>)` inside Recharts props (these are scoped by `ChartStyle`). Use `var(--chart-5)` for the budget ceiling reference line (neutral/warning color).

### `satisfies ChartConfig`
Always write chart config objects as:
```typescript
const config = {
  spend: { label: "Monthly Spend", color: "var(--chart-1)" },
} satisfies ChartConfig
```
This gives full TypeScript narrowing of the config keys.

### Tab default
The default tab is Overview. When rendering the default, the URL should be `/reports` (no `?tab=` param). The `handleTabChange` function should skip setting the param when the value is `"overview"`.
