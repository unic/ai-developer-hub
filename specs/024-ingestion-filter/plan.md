# Implementation Plan: Invoice Ingestion Filters

**Branch**: `024-ingestion-filter` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-ingestion-filter/spec.md`

## Summary

Add a post-ingestion filter engine for invoice PDFs. Admins define global whitelist/blacklist rules matching on vendor name or invoice number pattern. After extraction, every invoice is evaluated against enabled rules. Matching invoices are still stored (PDF + record) but marked `filtered_out = true` and excluded from budget period linking. A new "filtered" ingestion outcome provides auditability. The admin UI is a new section on the existing `/settings/ingestion` page.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, Zod 4.3.6, TanStack Table 8.21.3, shadcn/ui (new-york), Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` + Drizzle ORM
**Testing**: Vitest (unit/integration)
**Target Platform**: Web (Node.js LTS server, modern browsers)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Filter evaluation < 50ms per invoice (DB query for rules + in-memory evaluation)
**Constraints**: No new npm dependencies required. All UI via existing shadcn/ui components.
**Scale/Scope**: Tens of filter rules (not thousands). Evaluated per-invoice at ingestion time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. Zod schemas for filter value validation. Exported types for public interfaces. |
| II. UX Consistency | PASS | Filter management uses existing shadcn/ui components (DataTable, Sheet/Dialog, Badge, Switch). No ad-hoc styling. |
| III. Performance Budgets | PASS | Filter evaluation is a single DB query + in-memory loop. No new JS bundles beyond the admin settings page. |
| IV. Accessibility-First | PASS | Using semantic HTML + shadcn/ui which includes focus management, ARIA attributes, keyboard navigation. |
| V. Simplicity & Maintainability | PASS | Single new module (`ingestion-filters.ts`) with pure evaluation logic. No speculative abstractions. CRUD follows existing action patterns exactly. |

**Post-Phase 1 Re-check**: All gates still pass. No new dependencies, no complex abstractions.

## Project Structure

### Documentation (this feature)

```text
specs/024-ingestion-filter/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── db/
│   │   ├── schema.ts                    # MODIFY: add ingestionFilters table, filterField/filterMode enums, filteredOut column on invoices, extend ingestionOutcome enum
│   │   └── migrations/
│   │       └── 0016_add_ingestion_filters.sql  # NEW: migration
│   ├── ingestion-filters.ts             # NEW: filter evaluation engine
│   ├── ingestion-logger.ts              # MODIFY: support "filtered" outcome
│   └── validators.ts                    # MODIFY: add filter CRUD schemas
├── actions/
│   ├── ingestion-filters.ts             # NEW: CRUD server actions
│   └── invoices.ts                      # MODIFY: integrate filter check in saveInvoice
├── app/
│   ├── api/invoices/ingest/route.ts     # MODIFY: integrate filter check in API route
│   └── settings/ingestion/
│       ├── page.tsx                     # MODIFY: add filters section above history table
│       ├── ingestion-history-table.tsx  # MODIFY: add "filtered" outcome badge + facet
│       └── ingestion-filters-section.tsx # NEW: filter management UI component
└── types/
    └── index.ts                         # Possibly extend if needed
```

**Structure Decision**: Follows existing Next.js App Router layout. New files are minimal — one lib module, one server actions file, one UI component. All modifications are to existing files following established patterns.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.
