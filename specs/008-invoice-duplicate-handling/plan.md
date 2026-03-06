# Implementation Plan: Invoice Duplicate Handling & Amount Display

**Branch**: `008-invoice-duplicate-handling` | **Date**: 2026-03-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-invoice-duplicate-handling/spec.md`

## Summary

Improve invoice upload reliability by detecting duplicate invoices (by invoice number), giving admins explicit skip/overwrite control on single uploads, auto-skipping duplicates in bulk uploads, and displaying extracted amounts in dollars instead of cents. No database schema changes required — all modifications are at the application and UI layer.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, React Hook Form 7.71.2, Zod 4.3.6, TanStack Table 8.21.3, shadcn/ui, Sonner (toasts), @aws-sdk/client-s3 (R2)
**Storage**: Neon PostgreSQL (serverless) via Drizzle ORM + Cloudflare R2 (PDF blobs)
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Next.js, server-rendered)
**Project Type**: Web application (full-stack)
**Performance Goals**: Standard web app — duplicate check response < 500ms, overwrite completes < 5s
**Constraints**: No database schema changes; amounts stored as integer cents; R2 blob cleanup is best-effort
**Scale/Scope**: Single admin user, typical batch size 10-50 invoices

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new actions use typed inputs/outputs; Zod validation unchanged |
| II. UX Consistency | PASS | Dollar input matches existing billed cost pattern (`step="0.01"`); shadcn/ui dialog for duplicate resolution |
| III. Performance Budgets | PASS | No new routes; duplicate check is a single indexed DB query; no bundle impact beyond dialog component |
| IV. Accessibility-First | PASS | Duplicate dialog uses shadcn AlertDialog (keyboard navigable, ARIA); duplicate flags use text + icon (not color alone) |
| V. Simplicity & Maintainability | PASS | No new abstractions; reuses existing patterns (R2 cleanup, billed cost linking, formatCurrency utility) |

**Post-Phase 1 re-check**: All gates still pass. No new dependencies introduced. Data model unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/008-invoice-duplicate-handling/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api-contracts.md # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actions/
│   └── invoices.ts              # Modified: add checkInvoiceDuplicate, checkBulkDuplicates,
│                                #   overwriteInvoice, cleanupBlob; modify saveInvoice, saveBulkInvoices
├── app/
│   └── invoices/
│       ├── new/
│       │   └── invoice-upload-form.tsx  # Modified: dollar input, duplicate check + dialog
│       └── bulk/
│           └── bulk-upload-form.tsx     # Modified: duplicate flags, skip logic, dollar display
└── lib/
    └── validators.ts            # No changes (amountCents stays as-is)
```

**Structure Decision**: No new files or directories needed. All changes fit within the existing structure. The feature modifies 3 existing files (`invoices.ts`, `invoice-upload-form.tsx`, `bulk-upload-form.tsx`).

## Complexity Tracking

No constitution violations to justify. All changes follow existing patterns.
