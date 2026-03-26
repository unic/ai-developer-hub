# Implementation Plan: Ingestion History Tab

**Branch**: `023-ingestion-history` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/023-ingestion-history/spec.md`

## Summary

Add a dedicated "Ingestion" settings subtab that displays a filterable, sortable history of all document-based ingestion attempts (manual uploads, API ingest, bulk uploads). A new `ingestion_log` table tracks both successful and failed attempts. Error details are shown via clickable popovers (reusing the sync status pattern), and successfully ingested documents are downloadable via existing presigned URL infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, TanStack Table 8.21.3, shadcn/ui (new-york), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — 1 new table, 2 new enums
**Testing**: Vitest (unit), pnpm typecheck, pnpm lint
**Target Platform**: Web (Next.js on Vercel)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: < 2s page load for up to 500 ingestion records (SC-004)
**Constraints**: Admin-only access, no new npm packages required
**Scale/Scope**: Low volume (~10-50 ingestion attempts/month), single settings page with one table

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode, Drizzle schema typed, Zod validation where needed |
| II. UX Consistency | PASS | Reuses DataTable, ErrorPopover, OutcomeBadge from existing pages. Design tokens only. |
| III. Performance Budgets | PASS | Single server-rendered page with paginated query. No heavy client bundles. |
| IV. Accessibility-First | PASS | DataTable already keyboard navigable. Popover uses Radix primitives with ARIA. |
| V. Simplicity & Maintainability | PASS | No new abstractions. Reuses existing components. Single new table. |

**Post-Phase 1 Re-check**: All gates still pass. No new dependencies, no complex abstractions introduced.

## Project Structure

### Documentation (this feature)

```text
specs/023-ingestion-history/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Phase 1 quickstart guide
├── contracts/
│   └── api-contracts.md # Phase 1 API contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── settings/
│       └── ingestion/
│           ├── page.tsx                    # NEW — Server component, admin-gated
│           └── ingestion-history-table.tsx # NEW — Client component, TanStack Table
├── actions/
│   └── ingestion-log.ts                   # NEW — getIngestionHistory server action
├── components/
│   ├── error-popover.tsx                  # MOVED from app/settings/sync/
│   └── outcome-badge.tsx                  # MOVED from app/settings/sync/
└── lib/
    └── db/
        ├── schema.ts                      # MODIFIED — add ingestion_log table + enums
        └── migrations/
            └── 0014_add_ingestion_log.sql # NEW — migration

# MODIFIED files (ingestion logging hooks):
src/app/api/invoices/ingest/route.ts       # Add ingestion_log writes on success/failure
src/actions/invoices.ts                     # Add ingestion_log writes in saveInvoice/saveBulkInvoices
src/app/settings/settings-nav.tsx           # Add "Ingestion" to adminTabs
src/app/settings/sync/scheduled-jobs-table.tsx  # Update imports for moved components
src/app/settings/sync/manual-jobs-table.tsx     # Update imports for moved components
```

**Structure Decision**: Follows existing Next.js App Router convention — new route at `app/settings/ingestion/`, new server action in `actions/`, shared UI components promoted to `components/`.

## Complexity Tracking

No constitution violations. Table left empty intentionally.
