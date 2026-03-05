# Research: Rich Visual Reports

**Feature**: 005-rich-reports | **Date**: 2026-03-05

## Decision Log

### D-001: Tab Navigation — URL-Reflected State Strategy

**Decision**: Server Component `page.tsx` reads `searchParams` (a `Promise` in Next.js 15) to determine the active tab. A thin `"use client"` `ReportsTabBar` component receives `activeTab` as a prop and uses `router.replace` + shadcn/ui `Tabs` (controlled via `value`) to update the URL on tab click.

**Rationale**: Keeps all data fetching in the Server Component (consistent with the existing `reports/page.tsx`, `budget/page.tsx`, `assignments/page.tsx` pattern). No `useSearchParams` is needed in the client component — it receives the active tab as a prop — which avoids the Next.js 15 Suspense requirement for `useSearchParams`. Tab switches use `router.replace` with `{ scroll: false }` so no new browser history entries are created and the page does not scroll to the top.

**Alternatives considered**:
- Full client component page (`"use client"` on `page.tsx`): Rejected — loses server-side parallel data fetching; all `await` calls would become `useEffect`/SWR fetches, a significant regression from the existing pattern.
- Parallel routes / intercepting routes: Rejected — designed for modal overlays and slot-level loading, not tab UIs; adds unnecessary routing complexity.
- `nuqs` library for search-param state: Rejected — adds a dependency for a problem solvable with two lines of `URLSearchParams` + `router.replace`.

**URL format**: `?tab=trends` | `?tab=usage` | `?tab=forecast` | (omit for default Overview to keep clean URLs)

**Next.js 15 gotcha**: `searchParams` is a `Promise<{...}>` — must be `await`ed in the Server Component. This makes the route dynamically rendered, which is already the case for authenticated admin pages.

---

### D-002: Chart Library — Recharts via shadcn/ui ChartContainer

**Decision**: Use Recharts 2.15.4 (already installed) exclusively through the shadcn/ui `ChartContainer` wrapper, except for sparklines which use raw `LineChart` with fixed pixel dimensions.

**Rationale**: Recharts is already a production dependency. The shadcn/ui `ChartContainer` wrapper provides theme-aware CSS variables (`var(--chart-1)` through `var(--chart-5)`), eliminates the need to add `ResponsiveContainer` manually, and keeps light/dark mode consistent with the rest of the UI.

**Component choices per tab**:

| Tab | Recharts Component | Wrapper |
|-----|-------------------|---------|
| Trends (time-series) | `LineChart` + `Line` | `ChartContainer`, `ChartTooltip`, `ChartTooltipContent` |
| Overview (sparklines) | `LineChart` (raw, fixed 80×32px, no decorations) | None — `ChartContainer` adds `ResponsiveContainer` which doesn't work in constrained inline contexts |
| Usage (utilization) | `BarChart layout="vertical"` + 2 stacked `Bar` components | `ChartContainer`, `ChartTooltip`, `ChartLegend` |
| Forecast (composite) | `LineChart` + 2 `Line` (one solid, one `strokeDasharray`) + `ReferenceLine` | `ChartContainer`, `ChartTooltip`, `ChartLegend` |

**Forecast chart technique**: Split data into two series — `historical` (null for future months) and `projected` (null for past months). Set `connectNulls={false}` on both. The last historical month also receives a `projected` value to visually connect the two lines without a gap.

**ReferenceLine for budget ceiling**: `y={budgetCeilingCents}` with `strokeDasharray="4 2"` and `ifOverflow="extendDomain"` to ensure the ceiling line is always visible.

**Alternatives considered**:
- Recharts `ComposedChart` for forecast: Not needed — `LineChart` with two `Line` children achieves the same result more simply.
- Pure SVG for sparklines: Valid approach, but raw Recharts `LineChart` at 80×32 with `isAnimationActive={false}` is simpler to implement given the dependency is already present.
- Recharts v3: Would require upgrading a production dependency mid-feature; rejected.

---

### D-003: Bundle Strategy — Single Lazy Boundary for all Charts

**Decision**: All four chart components are imported directly inside a single `src/components/reports/reports-charts-panel.tsx` file. That panel is lazy-loaded from `reports-tab-bar.tsx` via `next/dynamic({ ssr: false })`. A single `<Skeleton>` fallback covers the loading state.

**Rationale**: Recharts 2.x is ~80 KB gzip and cannot be tree-shaken by chart type. A single `dynamic()` boundary produces one chunk containing the full Recharts cost paid once per reports page visit. Multiple `dynamic()` imports would still cost the same total size but introduce multiple network waterfalls. The reports route is already admin-only, so this chunk is isolated from all other routes.

**Performance notes**:
- `isAnimationActive={false}` on sparklines (no CLS from animation).
- `accessibilityLayer` on every chart root component (Recharts built-in keyboard/screen reader support — no extra bundle cost).
- All chart data values remain in integer cents; division by 100 for display happens only in formatter callbacks.
- `ChartConfig` objects use `satisfies ChartConfig` for full TypeScript narrowing.

---

### D-004: OLS Forecast — Pure TypeScript Utility Module

**Decision**: Implement ordinary least squares (OLS) linear regression in `src/lib/forecast.ts` as a pure server-side utility. The Server Action `getBudgetForecast(budgetId)` in `src/actions/budget.ts` calls `forecastBudget()` from this module.

**Rationale**: No external ML library needed; OLS is ~30 lines of arithmetic. The module is pure (no DB access, no browser APIs), making it trivially unit-testable with Vitest. Monetary arithmetic stays in integer cents throughout; regression coefficients are floats internally (acceptable for a linear fit), but all returned projected values are `Math.round()`-ed to integers and floored at 0 with `Math.max(0, ...)`.

**Baseline window**: Up to 12 months of historical `billedCosts` data, sourced from completed `budgetPeriods` (periods where `endDate < today` and `billedTotalCents > 0`).

**Edge cases**:
- `history.length < 3`: Returns early with `insufficientData` message; still computes `"on_track"` / `"at_risk"` from actual spend vs. ceiling.
- All-zero history: OLS runs normally; slope = 0, projections = 0.
- Negative projected values: Floored to 0 via `Math.max(0, Math.round(raw))`.
- Malformed period label: Falls back to `today`'s year/month as calendar base.

**On-track / at-risk formula**:
```
projectedRemainingCents = Σ projection[i].projectedAmountCents
projectedAnnualTotal    = actualSpendToDateCents + projectedRemainingCents
status = projectedAnnualTotal <= budgetCeilingCents ? "on_track" : "at_risk"
```

**Alternatives considered**:
- Simple moving average: More intuitive but ignores trend direction (can't detect accelerating spend). OLS captures slope, which is exactly what a budget forecast needs.
- Exponential smoothing (Holt-Winters): Better for seasonality but overkill for a 12-month dataset; adds implementation complexity with no corresponding benefit at this scale.
- External library (ml-regression, simple-statistics): Adds a dependency for 30 lines of math; rejected per Constitution Principle V (Simplicity).

---

### D-005: New Server Actions Required

**Decision**: Three new query functions added to existing actions files; no new action files created.

| Function | File | Purpose |
|----------|------|---------|
| `getBilledCostsTimeSeries(budgetId)` | `src/actions/budget.ts` | Returns per-period `{month, billedTotalCents, expectedSpendCents}` for the Trends chart |
| `getLicenseUtilizationByTool()` | `src/actions/assignments.ts` | Returns `{toolId, toolName, assigned, maxLicenses, utilizationPct}` for the Usage chart |
| `getBudgetForecast(budgetId)` | `src/actions/budget.ts` | Wraps `forecastBudget()` from `src/lib/forecast.ts`; returns `ActionResult<BudgetForecast>` |

**Rationale for reusing existing files**: The codebase has one file per domain (`budget.ts`, `assignments.ts`). Adding to existing files keeps the domain boundary clear and avoids a new file for what is ultimately a query function.

**No schema changes required**: All data exists in `billedCosts`, `budgetPeriods`, `licenseAssignments`, and `aiTools` (`maxLicenses` column). The utilization percentage is computed in application code, not the DB.

---

### D-006: Skeleton Loading Pattern

**Decision**: Tab content area shows layout-matching skeleton screens while data loads. Each tab's skeleton mirrors the shape of its content (card grid for Overview, tall chart placeholder for Trends/Forecast, shorter stacked-bar placeholder for Usage).

**Implementation**: Use the existing `src/components/ui/skeleton.tsx` (`animate-pulse`, `bg-accent`) following the established pattern in `src/app/reports/loading.tsx` and other loading files. The `dynamic()` loading fallback for `ReportsChartsPanel` passes `<ReportsSkeleton />` as its `loading` prop.

**Rationale**: All other pages in the project use this exact pattern. CLS is minimized because skeleton dimensions match final content dimensions (`min-h-[300px]` on chart containers matches the `className` on `ChartContainer`).

---

### D-007: Existing Reports Content Migration

**Decision**: The existing Overview content (4 summary cards + Tool Adoption table + Circle Report table) moves into the Overview tab verbatim. No data is removed; it is reorganized under a tab.

**Rationale**: The spec states existing content should be reorganized under Overview, not replaced. The summary cards become enhanced with sparkline trend indicators. The Tool Adoption table becomes the Usage tab's table view (with a chart toggle added).

---

## Research Sources

- Next.js 15 `searchParams` API: https://nextjs.org/docs/app/api-reference/file-conventions/page
- Next.js `useRouter` App Router: https://nextjs.org/docs/app/api-reference/functions/use-router
- shadcn/ui Tabs: https://ui.shadcn.com/docs/components/radix/tabs
- shadcn/ui Chart: https://ui.shadcn.com/docs/components/chart
- Recharts API (local installation): src/components/ui/chart.tsx
- OLS linear regression: standard statistics (no external source required)
