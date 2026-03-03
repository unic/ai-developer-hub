# Implementation Plan: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02 | **Spec**: [spec.md](specs/001-ai-tool-budget-tracker/spec.md)
**Input**: Feature specification from `/specs/001-ai-tool-budget-tracker/spec.md`

## Summary

Internal single-tenant web application for tracking AI coding tool licenses, user assignments, access tiers, and annual budget planning. Built with Next.js App Router, Neon PostgreSQL on Vercel, and shadcn/ui components. Supports Admin (full CRUD) and Viewer (read-only dashboards) roles with real-time budget variance tracking and per-tool cost attribution.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Framework**: Next.js 15 (App Router, Server Components, Server Actions)
**Primary Dependencies**: shadcn/ui, Tailwind CSS, Drizzle ORM, next-auth
**Storage**: Neon PostgreSQL (serverless driver `@neondatabase/serverless`) hosted on Vercel
**Testing**: Vitest (unit/integration), Playwright (e2e + a11y via @axe-core/playwright), @lhci/cli (Lighthouse CI)
**Target Platform**: Vercel (production), modern browsers (Chrome, Firefox, Safari, Edge)
**Project Type**: web-application (full-stack Next.js)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, initial JS bundle < 150KB gzipped per route (per constitution)
**Constraints**: Single-tenant, single-currency, up to 500 users and 20 AI tools
**Scale/Scope**: ~10 primary routes/pages, 7 database tables, 2 roles (Admin/Viewer)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Type-Safe Code Quality | PASS | TypeScript strict mode, Drizzle ORM provides typed schema, ESLint + Prettier enforced in CI |
| II | UX Consistency | PASS | shadcn/ui as shared component library, Tailwind CSS design tokens, consistent interaction patterns |
| III | Performance Budgets | PASS | Next.js App Router with Server Components minimizes client JS, Neon serverless driver, per-route code splitting |
| IV | Accessibility-First | PASS | shadcn/ui components are built on Radix UI primitives (keyboard navigable, ARIA-compliant), a11y audit in CI |
| V | Simplicity & Maintainability | PASS | Minimal dependencies (Next.js, Drizzle, shadcn/ui, next-auth), no speculative abstractions, single monolith |

**Technology Standards Compliance**:
- Runtime: Node.js LTS — PASS
- Language: TypeScript strict — PASS
- Framework: Next.js (React-based SSR) — PASS
- Styling: Tailwind CSS with design tokens via shadcn/ui — PASS
- State Management: Server Components + Server Actions for server state, minimal client state — PASS
- Package Manager: pnpm — PASS
- Security: `npm audit` in CI, `.env.local` for secrets, Vercel env vars for production — PASS

**Gate Result**: ALL PASS — proceed to Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout (providers, nav)
│   ├── page.tsx                # Dashboard home
│   ├── (auth)/                 # Auth route group
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── tools/                  # AI tool registry
│   │   ├── page.tsx            # Tool list
│   │   ├── [id]/page.tsx       # Tool detail/edit
│   │   └── new/page.tsx        # Add new tool
│   ├── users/                  # User management
│   │   ├── page.tsx            # User directory
│   │   ├── [id]/page.tsx       # User detail/edit
│   │   ├── new/page.tsx        # Add new user
│   │   └── import/page.tsx     # Bulk import
│   ├── assignments/            # License assignments
│   │   └── page.tsx            # Assignment management
│   ├── budget/                 # Budget planning & tracking
│   │   ├── page.tsx            # Budget overview/dashboard
│   │   ├── [id]/page.tsx       # Budget detail
│   │   └── new/page.tsx        # Create annual budget
│   ├── reports/                # Reporting & dashboards
│   │   └── page.tsx            # Reports & charts
│   └── api/                    # API routes (if needed beyond Server Actions)
│       └── auth/[...nextauth]/ # NextAuth API route
├── components/                 # Shared UI components
│   └── ui/                     # shadcn/ui components
├── lib/                        # Shared utilities
│   ├── db/                     # Database layer
│   │   ├── schema.ts           # Drizzle schema definitions
│   │   ├── index.ts            # DB connection (Neon)
│   │   └── migrations/         # Drizzle migrations
│   ├── auth.ts                 # NextAuth configuration
│   ├── validators.ts           # Zod schemas for form/API validation
│   └── utils.ts                # General utilities
├── actions/                    # Server Actions (business logic)
│   ├── tools.ts                # Tool CRUD actions
│   ├── users.ts                # User CRUD actions
│   ├── assignments.ts          # License assignment actions
│   ├── budget.ts               # Budget management actions
│   └── history.ts              # Change history actions
└── types/                      # Shared TypeScript types

tests/
├── unit/                       # Unit tests (Vitest)
├── integration/                # Integration tests (Vitest)
└── e2e/                        # End-to-end tests (Playwright)
```

**Structure Decision**: Single Next.js full-stack project using App Router. Server Actions replace a separate API layer for most mutations. The `src/` directory prefix keeps app code separate from config files. shadcn/ui components live in `src/components/ui/` per shadcn conventions. Drizzle ORM schema and migrations under `src/lib/db/`.

## Post-Design Constitution Re-Check

*Re-evaluated after Phase 1 design completion.*

| # | Principle | Status | Post-Design Notes |
|---|-----------|--------|-------------------|
| I | Type-Safe Code Quality | PASS | Drizzle schema provides typed DB layer. Zod schemas shared between client/server validation. TanStack Table column defs are fully typed. All exported types from `src/types/`. |
| II | UX Consistency | PASS | 24 shadcn/ui components selected (all Radix-based). Design tokens via Tailwind v4 CSS variables. Consistent Server Action response pattern across all mutations. |
| III | Performance Budgets | PASS | Drizzle ORM ~50KB (fits budget). Client-side tables for ≤500 rows avoids server roundtrips. Recharts is tree-shakeable. Server Components minimize client JS. |
| IV | Accessibility-First | PASS | All shadcn/ui components are Radix-based (keyboard + ARIA). @axe-core/playwright for runtime a11y in CI. eslint-plugin-jsx-a11y for static checks. |
| V | Simplicity & Maintainability | PASS | 12 production deps, 10 dev deps. Single Next.js project (no monorepo). Server Actions eliminate separate API. Single DB driver (neon-serverless). No speculative features. |

**Post-Design Gate Result**: ALL PASS — no violations, no justifications needed.

## Complexity Tracking

> No constitution violations detected. All gates pass.
