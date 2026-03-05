# Tasks: Rich Visual Reports (005-rich-reports)

**Branch**: `005-rich-reports` | **Date**: 2026-03-05

## Phase 1: Types & Pure Utility

- [X] T-001 Add report data types to `src/types/index.ts` (PeriodSpendPoint, ToolUtilization, BudgetForecast, ReportOverviewData, ForecastChartPoint, ToolSummaryItem, CircleReportItem)
- [X] T-002 Create `src/lib/forecast.ts` — OLS linear regression pure utility

## Phase 2: Server Actions

- [X] T-003 Add `getBilledCostsTimeSeries(budgetId)` to `src/actions/budget.ts`
- [X] T-004 Add `getBudgetForecast(budgetId)` to `src/actions/budget.ts`
- [X] T-005 Add `getLicenseUtilizationByTool()` to `src/actions/assignments.ts`

## Phase 3: Chart Components

- [X] T-006 Create `src/components/reports/sparkline.tsx` — inline 80×32 LineChart
- [X] T-007 Create `src/components/reports/trends-chart.tsx` — time-series LineChart with range selector
- [X] T-008 Create `src/components/reports/utilization-chart.tsx` — vertical stacked BarChart
- [X] T-009 Create `src/components/reports/forecast-chart.tsx` — composite LineChart + ReferenceLine

## Phase 4: Client Components

- [X] T-010 Create `src/components/reports/reports-charts-panel.tsx` — lazy bundle boundary
- [X] T-011 Create `src/app/reports/reports-tab-bar.tsx` — client tab nav with URL routing

## Phase 5: Page & Loading Updates

- [X] T-012 Update `src/app/reports/page.tsx` — searchParams, new fetches, ReportsTabBar
- [X] T-013 Update `src/app/reports/loading.tsx` — chart-shaped skeleton placeholders

## Phase 6: Tests & Config

- [X] T-014 Create `vitest.config.ts`
- [X] T-015 Create `tests/unit/forecast.test.ts` — Vitest unit tests for OLS module

## Notes

- No DB schema changes required
- All monetary values kept as integer cents throughout
- Recharts loaded only via next/dynamic({ ssr: false }) boundary
