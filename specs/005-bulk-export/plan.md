# Implementation Plan: Bulk Data Export (Round-Trip)

**Branch**: `005-bulk-export` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-bulk-export/spec.md`

## Summary

Add CSV export endpoints for license assignments and users that produce files in the exact same format as the existing bulk import. This enables a round-trip workflow: export → edit in spreadsheet → re-import. Implementation uses Next.js API route handlers returning CSV responses, a shared CSV utility for RFC 4180 escaping, and existing `decryptApiKey()` for API key handling. No new database tables or dependencies are needed.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, date-fns 4.1.0, shadcn/ui + Lucide React
**Storage**: Neon PostgreSQL (serverless) via Drizzle ORM — read-only for this feature
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Node.js server + browser client)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Export of 1,000 records in < 5 seconds
**Constraints**: CSV must be RFC 4180 compliant; round-trip compatible with existing import schemas
**Scale/Scope**: Up to 10,000 rows per export; 2 new API routes, 1 new utility, 2 UI modifications

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. CSV utility will export well-defined types. |
| II. UX Consistency | PASS | Export buttons use shadcn/ui `Button` with `variant="outline"` and Lucide `Download` icon. No ad-hoc styling. |
| III. Performance Budgets | PASS | Export is a file download via API route — no impact on page JS bundle. No new client-side JS beyond a button click. |
| IV. Accessibility-First | PASS | Export buttons are standard `<a>` elements styled as buttons — fully keyboard accessible with native browser download behavior. |
| V. Simplicity & Maintainability | PASS | No new dependencies. Single shared CSV utility. API route handlers follow existing patterns. No speculative abstractions. |

**Post-Phase 1 re-check**: All principles still pass. No violations introduced by the design.

## Project Structure

### Documentation (this feature)

```text
specs/005-bulk-export/
├── plan.md              # This file
├── research.md          # Phase 0: CSV strategy, delivery mechanism, crypto, queries
├── data-model.md        # Phase 1: Entity-to-CSV field mappings
├── quickstart.md        # Phase 1: Implementation guide
├── contracts/
│   ├── server-actions.md  # Phase 1: API route handler contracts
│   └── ui-contracts.md    # Phase 1: Export button placement and behavior
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── api/
│   │   └── export/
│   │       ├── assignments/
│   │       │   └── route.ts          # NEW: GET handler for assignment CSV export
│   │       └── users/
│   │           └── route.ts          # NEW: GET handler for user CSV export
│   ├── assignments/
│   │   └── import/
│   │       ├── page.tsx              # MODIFY: Add export button
│   │       └── bulk-assignment-import-form.tsx  # (existing)
│   └── users/
│       └── import/
│           ├── page.tsx              # MODIFY: Add export button
│           └── bulk-import-form.tsx  # (existing)
├── lib/
│   ├── csv.ts                        # NEW: Shared CSV generation utility
│   ├── crypto.ts                     # (existing: decryptApiKey)
│   ├── auth-helpers.ts               # (existing: requireAdmin)
│   └── db/
│       └── schema.ts                 # (existing: table definitions)
└── actions/                          # (no changes needed)

tests/
├── unit/
│   └── csv.test.ts                   # NEW: CSV utility tests
└── integration/
    └── export.test.ts                # NEW: Export endpoint tests
```

**Structure Decision**: Follows existing Next.js App Router convention. New API routes under `src/app/api/export/`. Shared CSV utility in `src/lib/` alongside existing utilities.

## Complexity Tracking

No constitution violations. This table is intentionally empty.
