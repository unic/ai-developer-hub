# Implementation Plan: Enhance Core Features

**Branch**: `003-enhance-core-features` | **Date**: 2026-03-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-enhance-core-features/spec.md`

## Summary

Enhance the AI Developer Hub with six interconnected improvements: (1) unauthenticated user experience with role-based sidebar navigation, (2) rename "Department" to "Circle" across UI, validators, database schema, and CSV import, (3) editable tool tiers with full change history, (4) editable license assignments with retrospective dating, (5) assignment meta fields (workspace, API key, timestamped comments), and (6) budget billed costs tracking with expected/billed variance reporting. All changes build on the existing Next.js 15 App Router + Drizzle ORM + Neon PostgreSQL stack with no new framework dependencies.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS, React 19.2.4
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui + radix-ui, React Hook Form 7.71.2, Zod 4.3.6, TanStack Table 8.21.3, Recharts 2.15.4, date-fns 4.1.0, react-day-picker 9.14.0
**Storage**: Neon PostgreSQL (serverless) via @neondatabase/serverless 1.0.2
**Testing**: Vitest 4.0.18 (unit/integration), Playwright 1.58.2 (e2e + a11y via @axe-core/playwright), @lhci/cli (Lighthouse CI)
**Target Platform**: Web (SSR/SSG via Next.js), modern browsers
**Project Type**: Web application (full-stack Next.js)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle < 150KB gzipped per route (constitution III)
**Constraints**: Monetary values as integers (cents), JWT session strategy, pnpm lockfile
**Scale/Scope**: Internal tool management application, ~7 main routes, 7 database tables expanding to ~9

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Type-Safe Code Quality** | PASS | All new code will use strict TypeScript. New Zod schemas for billed costs, assignment meta, assignment comments. New Drizzle table types exported. Server actions follow existing `ActionResult<T>` pattern. |
| **II. UX Consistency** | PASS | All new UI uses shadcn/ui primitives (Dialog, Form, Table, Input, DatePicker). No ad-hoc styling. Design tokens via Tailwind CSS. Role-based sidebar uses existing `SidebarMenuItem` components. |
| **III. Performance Budgets** | PASS | No new heavy dependencies. Assignment comments loaded on-demand in detail view. Billed cost entries scoped to individual budget periods. No bundle impact concerns. |
| **IV. Accessibility-First** | PASS | All new forms use shadcn/ui (built on radix-ui with ARIA). DatePicker via react-day-picker (keyboard accessible). Masked API key field needs reveal button with proper aria-label. Role-restricted pages show accessible "access restricted" message. |
| **V. Simplicity & Maintainability** | PASS | No new framework dependencies. DB column rename uses standard Drizzle migration. Meta fields are simple columns (not JSONB nesting). Comments as a separate table keeps single responsibility. Billed costs as a dedicated table (not embedded in budget periods). |
| **Technology Standards** | PASS | Same stack — TypeScript strict, Next.js, Tailwind, pnpm. No new third-party scripts. |
| **Development Workflow** | PASS | Feature branch `003-enhance-core-features` from main. Conventional commits. CI gates preserved. |

**Gate result**: ALL PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/003-enhance-core-features/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── layout.tsx                          # Modified: unauthenticated sidebar rendering
│   ├── (auth)/login/page.tsx               # Existing: login page (unchanged)
│   ├── assignments/
│   │   ├── assignments-client.tsx          # Modified: edit dialog, meta fields, retrospective date
│   │   └── [id]/page.tsx                   # New: assignment detail view (comments, API key reveal)
│   ├── budget/
│   │   └── [id]/budget-detail-client.tsx   # Modified: billed costs section, expected/billed/variance
│   ├── reports/page.tsx                    # Modified: "Department" → "Circle", "actual" → "expected"
│   ├── tools/[id]/tool-detail-client.tsx   # Modified: tier edit dialog
│   └── users/
│       ├── import/bulk-import-form.tsx     # Modified: accept "department" and "circle" CSV headers
│       └── ...                             # Modified: "Department" → "Circle" in forms/tables
├── actions/
│   ├── assignments.ts                      # Modified: edit action, retrospective date, meta fields
│   ├── budget.ts                           # Modified: billed cost CRUD, expected cost rename
│   └── tools.ts                            # Existing: updateTier already exists (add history detail)
├── components/
│   ├── app-sidebar.tsx                     # Modified: role-based navigation, unauthenticated state
│   └── ui/                                 # Existing shadcn/ui components
├── lib/
│   ├── db/
│   │   └── schema.ts                       # Modified: new tables, column rename, new fields
│   ├── auth.ts                             # Minor: callbackUrl handling
│   └── validators.ts                       # Modified: new Zod schemas
├── middleware.ts                            # Modified: allow unauthenticated sidebar access
└── types/
    └── index.ts                            # Modified: new types for billed costs, comments, meta

tests/
├── unit/                                   # New: validator tests, role-based navigation logic
├── integration/                            # New: billed costs CRUD, assignment editing, retrospective dates
└── e2e/                                    # New: login flow, role-based sidebar, tier editing
```

**Structure Decision**: Existing Next.js App Router structure. All changes fit within the established `src/` layout. Two new database tables (`assignmentComments`, `billedCosts`). New fields on `licenseAssignments` (workspace, apiKey). Column rename on `users` (department → circle). No new top-level directories needed.

## Complexity Tracking

> No constitution violations — this section is empty by design.
