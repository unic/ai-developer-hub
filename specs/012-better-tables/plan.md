# Implementation Plan: Better Tables

**Branch**: `012-better-tables` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-better-tables/spec.md`

## Summary

Standardize all data tables across the application with universal column sorting, faceted column filtering on categorical columns, unified quick-action icons with tooltips and accessible labels, and a three-dot overflow menu for destructive actions. Migrate the two remaining plain HTML tables (Invoices, Budget list) to the shared DataTable component.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, TanStack Table 8.21.3, shadcn/ui (new-york style), Lucide React, Sonner (toasts)
**Storage**: Neon PostgreSQL via Drizzle ORM (no schema changes — this is a UI-only feature)
**Testing**: Vitest (unit), Playwright (e2e + a11y)
**Target Platform**: Web (desktop + mobile responsive)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Sorting and filtering interactions complete within 100ms (client-side only, no network). Meets existing Core Web Vitals budgets (LCP < 2.5s, INP < 200ms, CLS < 0.1).
**Constraints**: No new dependencies. All required UI components (DropdownMenu, Tooltip, AlertDialog) already exist in the shadcn/ui component library.
**Scale/Scope**: 5 data tables (Tools, Users, Assignments, Invoices, Budget list). Approximately 15-20 column definitions to update, 5 action columns to refactor.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All column definitions and action components will be fully typed via TanStack Table's `ColumnDef<TData>` generics. No `any` types needed. |
| II. UX Consistency | PASS | This feature's primary goal is UX consistency — standardizing icons, tooltips, labels, and interaction patterns across all tables. Uses shadcn/ui design system exclusively. |
| III. Performance Budgets | PASS | All sorting/filtering is client-side via TanStack Table (no network requests). No new JS bundles — TanStack Table, DropdownMenu, and Tooltip are already in the bundle. |
| IV. Accessibility-First | PASS | Adding tooltips and `aria-label` attributes to all action buttons. DropdownMenu and Tooltip from Radix UI provide built-in keyboard navigation and ARIA compliance. |
| V. Simplicity & Maintainability | PASS | Extracting shared patterns (sortable header, row actions) reduces duplication. No new abstractions beyond what's needed — reuses existing DataTable component. |

**Post-Phase 1 Re-check**: No violations detected. All design decisions align with constitution principles.

## Project Structure

### Documentation (this feature)

```text
specs/012-better-tables/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (component model)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (UI contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── data-table.tsx              # Shared DataTable (enhanced with TooltipProvider)
│   ├── data-table-column-header.tsx # NEW: Reusable sortable column header
│   ├── data-table-faceted-filter.tsx # NEW: Reusable faceted filter component
│   ├── data-table-row-actions.tsx   # NEW: Shared row action patterns (view, edit, overflow)
│   └── ui/
│       ├── dropdown-menu.tsx        # Existing (no changes)
│       ├── tooltip.tsx              # Existing (no changes)
│       ├── alert-dialog.tsx         # Existing (no changes)
│       └── table.tsx                # Existing (no changes)
├── app/
│   ├── tools/
│   │   └── tools-table.tsx          # Updated columns + overflow menu
│   ├── users/
│   │   └── users-table.tsx          # Updated columns + overflow menu
│   ├── assignments/
│   │   └── assignments-client.tsx   # Updated columns + overflow menu
│   ├── invoices/
│   │   ├── page.tsx                 # Refactored to delegate to client table
│   │   └── invoices-table.tsx       # NEW: Client component with DataTable
│   └── budget/
│       ├── page.tsx                 # Refactored to delegate to client table
│       ├── budget-table.tsx         # NEW: Client component with DataTable
│       └── budget-list-actions.tsx  # Updated to use overflow menu

tests/
├── unit/
│   ├── data-table-column-header.test.tsx  # NEW
│   ├── data-table-faceted-filter.test.tsx # NEW
│   └── data-table-row-actions.test.tsx    # NEW
└── e2e/
    └── table-consistency.spec.ts          # NEW: Cross-table consistency checks
```

**Structure Decision**: Follows the existing Next.js App Router convention. Shared table components live in `src/components/` alongside the existing `data-table.tsx`. Page-specific table client components live alongside their pages. No new directories needed.

## Complexity Tracking

No constitution violations — table is not needed.
