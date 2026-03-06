# Implementation Plan: Invoice-to-Budget Period Sync

**Branch**: `009-invoice-syncing` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-invoice-syncing/spec.md`

## Summary

Add a sync engine that scans all invoices, matches each to the correct budget period (across both active and archived budgets), and corrects missing or wrong links. The feature includes a server action with dry-run support, a results dialog showing categorized outcomes (verified/newly linked/corrected/unresolvable), and a "Sync Invoices" button on the invoice listing page. No schema changes required — the sync operates entirely on existing tables and relationships.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, Zod 4.3.6, shadcn/ui, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via Drizzle ORM — no schema changes
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Next.js on Vercel)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Sync completes within 30 seconds for up to 500 invoices
**Constraints**: Per-invoice transaction isolation; no concurrent syncs
**Scale/Scope**: Hundreds of invoices, single admin user

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. Zod schemas for sync types. Unit test coverage for matching logic. |
| II. UX Consistency | PASS | Uses shadcn/ui Dialog, Button, Badge, Table. No ad-hoc styling. Follows existing invoice page patterns. |
| III. Performance Budgets | PASS | Sync is a server action, no impact on page load. Results dialog is lazy-loaded. No new JS bundle on initial page load. |
| IV. Accessibility-First | PASS | Dialog uses Radix Dialog (accessible by default). Results table uses semantic HTML. Button has clear label. |
| V. Simplicity & Maintainability | PASS | No new dependencies. No new DB tables. Reuses existing patterns (server actions, billed cost creation). Single responsibility: one action file, two UI components. |

**Post-Phase 1 re-check**: All principles still pass. No schema changes, no new dependencies, no abstractions beyond what's needed.

## Project Structure

### Documentation (this feature)

```text
specs/009-invoice-syncing/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity model (no schema changes)
├── quickstart.md        # Phase 1: development guide
├── contracts/           # Phase 1: server action contract
│   └── sync-invoices-action.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   └── invoice-sync.ts          # NEW: syncInvoices server action + findPeriodForDate
├── app/invoices/
│   ├── page.tsx                  # MODIFY: add Sync Invoices button
│   ├── sync-invoices-button.tsx  # NEW: client component for sync trigger
│   └── sync-results-dialog.tsx   # NEW: client component for results display
├── lib/
│   └── validators.ts             # MODIFY: add sync-related Zod schemas
└── types/
    └── index.ts                  # MODIFY: add SyncInvoiceOutcome, SyncResult types

tests/
├── unit/
│   └── invoice-sync.test.ts     # NEW: unit tests for matching logic
└── integration/
    └── invoice-sync.test.ts     # NEW: integration tests for sync action
```

**Structure Decision**: Follows existing Next.js App Router structure. New server action in `src/actions/` (consistent with `invoices.ts`, `budget.ts`). New client components co-located with the invoices page (consistent with `invoice-upload-form.tsx`, `bulk-upload-form.tsx`).

## Complexity Tracking

No constitution violations. No complexity justifications needed.
