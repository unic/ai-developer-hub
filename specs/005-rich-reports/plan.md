# Implementation Plan: Rich Visual Reports

**Branch**: `005-rich-reports` | **Date**: 2026-03-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-rich-reports/spec.md`

## Summary

Add a four-tab visual reporting dashboard (Overview, Trends, Usage, Forecast) to the existing `/reports` page. The existing Server Component is restructured to pass aggregated data to a new client-side `ReportsTabBar` with URL-reflected tab state (`?tab=<value>`). Charts are built with the already-installed Recharts 2.15.4 library via shadcn/ui `ChartContainer` wrappers, lazy-loaded as a single dynamic bundle to respect the 150 KB JS budget. A new `src/lib/forecast.ts` provides OLS linear regression for budget projections. Three new Server Action query functions deliver time-series spend, license utilization, and forecast data. **No database schema changes are required.**

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), Recharts 2.15.4 (already installed), shadcn/ui ChartContainer, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30
**Storage**: Neon PostgreSQL (serverless) — no schema changes; all report data derived from `annual_budgets`, `budget_periods`, `billed_costs`, `license_assignments`, `ai_tools`
**Testing**: Vitest (unit tests for `forecast.ts` OLS logic), Playwright (E2E tab navigation and chart rendering)
**Target Platform**: Web application — desktop-first (1280px+ primary), authenticated admin route
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Tab content within 2 seconds; Recharts lazy-loaded as single ~80 KB gzip chunk; LCP < 2.5s, INP < 200ms, CLS < 0.1
**Constraints**: 150 KB gzipped JS per route; Recharts must not appear in Server Components or SSR path; all monetary values in integer cents; no new DB tables
**Scale/Scope**: Up to 12 months of history for Trends/Forecast; top-10 default in Usage; one active budget per fiscal year

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | TypeScript strict throughout; `ChartConfig` uses `satisfies`; `forecastBudget()` fully typed; no `any` |
| II. UX Consistency | PASS | shadcn/ui `Tabs`, `Card`, `Skeleton`, `ChartContainer`, `ChartTooltipContent` used exclusively; no ad-hoc styling; design tokens only |
| III. Performance Budgets | PASS | Recharts lazy-loaded via single `dynamic({ ssr: false })` boundary; sparklines use raw `LineChart` with `isAnimationActive={false}`; `min-h-[300px]` on chart containers prevents CLS |
| IV. Accessibility-First | PASS | `accessibilityLayer` on all Recharts root components; shadcn `Tabs` is keyboard-navigable; status indicated by text + color (not color alone); ARIA roles from Radix UI Tabs |
| V. Simplicity & Maintainability | PASS | OLS in one 100-line pure utility file; no external ML libraries; no new abstractions beyond the minimum; each chart component has a single responsibility |

*Gate: PASS — no violations. Proceeding to Phase 1 design.*

## Project Structure

### Documentation (this feature)

```text
specs/005-rich-reports/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── server-actions.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code

```text
src/
├── app/
│   └── reports/
│       ├── page.tsx                          # MODIFY — add searchParams, new fetches, ReportsTabBar
│       ├── reports-tab-bar.tsx               # NEW — "use client", URL-reflected tab nav + data passing
│       └── loading.tsx                       # MODIFY — add chart-shaped skeleton placeholders
│
├── components/
│   └── reports/
│       ├── reports-charts-panel.tsx          # NEW — aggregates chart imports (single lazy-load boundary)
│       ├── trends-chart.tsx                  # NEW — "use client", LineChart time-series
│       ├── utilization-chart.tsx             # NEW — "use client", BarChart vertical stacked
│       ├── forecast-chart.tsx                # NEW — "use client", composite LineChart + ReferenceLine
│       └── sparkline.tsx                     # NEW — "use client", raw inline LineChart 80×32
│
├── lib/
│   └── forecast.ts                           # NEW — OLS linear regression, pure utility (server-only)
│
└── actions/
    ├── budget.ts                             # MODIFY — add getBilledCostsTimeSeries(), getBudgetForecast()
    └── assignments.ts                        # MODIFY — add getLicenseUtilizationByTool()

tests/
├── unit/
│   └── forecast.test.ts                      # NEW — Vitest unit tests for OLS module
└── e2e/
    └── reports-tabs.spec.ts                  # NEW — Playwright E2E for tab navigation
```

**Structure Decision**: Single Next.js App Router project (Option 1 from template). Chart components grouped in `src/components/reports/` as a domain sub-folder — consistent with how assignments groups related components. `reports-tab-bar.tsx` co-located with `page.tsx` following the `assignments-client.tsx` pattern.

## Complexity Tracking

No constitution violations to justify.
