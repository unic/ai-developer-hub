# Implementation Plan: GitHub Copilot Integration

**Branch**: `013-github-copilot-integration` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-github-copilot-integration/spec.md`

## Summary

Add a GitHub Copilot integration that syncs organization-level Copilot data (seat assignments, usage metrics, billing) into the existing AI Developer Hub. The integration bridges Copilot data into existing models (AI Tools, License Assignments, Billed Costs) for automatic inclusion in existing dashboards, while providing dedicated Copilot-specific analytics pages at `/copilot/*` for metrics not represented elsewhere (acceptance rates, language/editor breakdowns, utilization trends). Data is persisted locally to enable analysis beyond the GitHub API's 28-day metrics window.

**Technical approach**: Extend the existing GitHub connection with Copilot scope validation, build a three-stage sync pipeline (billing → seats → metrics) that runs daily via cron, and create 4 new dashboard tabs under a shared `/copilot` layout matching the Reports page tab bar pattern.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui (new-york), Recharts 2.15.4, TanStack Table 8.21.3, Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — 2 new tables, 3 table modifications, 1 new enum
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Node.js server, browser client)
**Project Type**: Web application (Next.js App Router with Server Components + Server Actions)
**Performance Goals**: All Copilot dashboards load within 3 seconds for orgs with up to 5,000 users (SC-005). Sync completes within 5 minutes for initial setup (SC-001).
**Constraints**: <150 KB gzipped JS per route (constitution). <2.5s LCP (constitution). Charts must use existing ChartContainer/Recharts patterns. No modifications to existing page components (SC-011).
**Scale/Scope**: Up to 5,000 Copilot users per org. ~365 metric records/year. ~12 billing snapshots/year. 4 new pages + 1 settings section + 1 API route.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. New Drizzle schema types exported. Zod validation on all inputs. Unit test coverage for sync pipeline and data transformations. |
| II. UX Consistency | PASS | Uses shadcn/ui components exclusively. Tab bar matches existing Reports pattern. Data tables reuse existing DataTable component. Charts use existing ChartContainer/ChartConfig. KPI cards follow existing dashboard card pattern. |
| III. Performance Budgets | PASS | Server-side data aggregation (no large client-side datasets). JSONB breakdowns queried server-side. Copilot pages are new routes — no impact on existing route budgets. Dashboard queries target pre-aggregated daily data (~365 rows/year max). |
| IV. Accessibility-First | PASS | Reuses existing accessible components (DataTable, Chart, Card, Badge). New interactive elements (sync toggle, date picker) use shadcn/ui primitives with built-in a11y. Charts include `accessibilityLayer` per existing pattern. |
| V. Simplicity & Maintainability | PASS | No new dependencies added. Reuses 10 existing infrastructure components. 2 new tables (minimal schema growth). Sync pipeline is a simple sequential 3-step process. No speculative abstractions. |
| Technology Standards | PASS | All within existing stack. pnpm package manager. No new frameworks. |
| Development Workflow | PASS | Feature branch pattern. Conventional commits. CI gates apply. |

**Post-Phase 1 re-check**: No violations introduced. JSONB fields for language/editor breakdowns are the simplest viable approach (avoids join-heavy normalized tables for read-heavy analytics). `source` discriminator on `licenseAssignments` is a single varchar column — minimal schema impact.

## Project Structure

### Documentation (this feature)

```text
specs/013-github-copilot-integration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: API research, decisions
├── data-model.md        # Phase 1: Schema design
├── quickstart.md        # Phase 1: Development guide
├── contracts/
│   └── server-actions.md # Phase 1: Action interfaces
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   ├── copilot.ts                  # Copilot connection management actions
│   └── copilot-data.ts             # Copilot data query actions
├── lib/
│   ├── copilot-sync.ts             # Sync pipeline (billing → seats → metrics)
│   ├── copilot-api.ts              # GitHub Copilot API wrapper
│   ├── db/
│   │   ├── schema.ts               # Modified: +2 new tables, +columns, +enum
│   │   └── migrations/
│   │       └── 0007_*.sql          # New migration
│   └── validators.ts               # Modified: +Copilot validation schemas
├── app/
│   ├── copilot/
│   │   ├── layout.tsx              # Tab bar layout
│   │   ├── page.tsx                # Overview dashboard
│   │   ├── copilot-tab-bar.tsx     # Tab navigation component
│   │   ├── seats/
│   │   │   ├── page.tsx            # Seat allocation table
│   │   │   └── [userId]/
│   │   │       └── page.tsx        # Seat detail view
│   │   ├── billing/
│   │   │   └── page.tsx            # Billing dashboard
│   │   └── analytics/
│   │       └── page.tsx            # Usage analytics
│   ├── api/
│   │   └── copilot/
│   │       └── sync/
│   │           └── route.ts        # Cron sync endpoint
│   └── settings/
│       └── integrations/
│           └── github-integration-client.tsx  # Modified: +Copilot section
├── components/
│   ├── app-sidebar.tsx             # Modified: +Copilot nav item
│   └── copilot/
│       ├── overview-cards.tsx      # KPI summary cards
│       ├── usage-trend-chart.tsx   # Suggestions/acceptances chart
│       ├── seats-table.tsx         # Seat allocation data table
│       ├── billing-trend-chart.tsx # Monthly cost trend
│       ├── cost-utilization-chart.tsx  # Cost vs. utilization
│       ├── language-chart.tsx      # Language breakdown
│       ├── editor-chart.tsx        # Editor breakdown
│       ├── activity-distribution.tsx   # User activity levels
│       └── copilot-sync-section.tsx    # Settings page section
└── types/
    └── index.ts                    # Modified: +Copilot types

tests/
├── unit/
│   ├── copilot-sync.test.ts       # Sync pipeline logic
│   ├── copilot-api.test.ts        # API wrapper with mocks
│   └── copilot-data.test.ts       # Data aggregation/transformation
└── e2e/
    └── copilot.spec.ts            # Dashboard rendering, sync flow
```

**Structure Decision**: Follows existing project conventions — actions in `src/actions/`, library code in `src/lib/`, pages in `src/app/`, components in `src/components/`. New Copilot-specific components isolated in `src/components/copilot/`. No structural changes to existing directories.

## Complexity Tracking

No constitution violations to justify. All design decisions align with existing patterns.
