# Implementation Plan: Decouple Copilot Billing from Budgets

**Branch**: `014-decouple-copilot-billing` | **Date**: 2026-03-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-decouple-copilot-billing/spec.md`

## Summary

Remove the tight coupling between the GitHub Copilot sync pipeline and the shared budget/billing system. The sync currently creates `billedCosts` entries when matching budget periods exist and backfills them later. This feature removes that write path entirely, drops the `linkedBilledCostId` column from `copilotBillingSnapshots`, cleans up orphaned billing entries, and removes the `backfillBilledCosts()` function. The Copilot billing page already reads exclusively from snapshots, so no UI changes are needed.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless`
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web application (Node.js server)
**Project Type**: Web service (Next.js App Router)
**Performance Goals**: Sync completion unaffected; billing page loads < 5s
**Constraints**: Migration must be reversible; no data loss for non-Copilot entries
**Scale/Scope**: 2 files modified, 1 migration generated, ~100 lines removed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | Removing a column triggers compile errors at all reference sites — strict mode ensures complete cleanup |
| II. UX Consistency | PASS | No UI changes; Copilot billing page continues to use snapshot data |
| III. Performance Budgets | PASS | Sync becomes faster (fewer DB queries); no new routes or bundles |
| IV. Accessibility-First | PASS | No UI changes |
| V. Simplicity & Maintainability | PASS | Removing coupling reduces complexity; no new abstractions |

**Post-design re-check**: All gates still pass. This feature strictly removes code and a schema column — no new complexity introduced.

## Project Structure

### Documentation (this feature)

```text
specs/014-decouple-copilot-billing/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Schema changes documentation
├── quickstart.md        # Implementation guide
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (files to modify)

```text
src/
├── lib/
│   ├── db/
│   │   ├── schema.ts           # Remove linkedBilledCostId column, index, relation
│   │   └── migrations/
│   │       └── 0007_*.sql      # Generated migration (column drop + data cleanup)
│   └── copilot-sync.ts         # Remove billing coupling and backfill function
```

**Structure Decision**: No new files or directories. This feature only modifies existing files and generates a standard Drizzle migration.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
