# Implementation Plan: GitHub Billing Sync

**Branch**: `015-github-billing` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-github-billing/spec.md`

## Summary

Re-establish the link between GitHub Copilot billing data and the shared budget system that was decoupled in feature 014. The sync pipeline in `copilot-sync.ts` will be extended with a new billing-to-budget linking step that creates/updates `billedCosts` entries using idempotent vendor-reference-based upserts. The Copilot billing dashboard gains budget context columns, and billing data flows back into main dashboard KPIs and reports. A 12-month backfill runs on first enable; subsequent syncs are incremental. Manual conflict detection preserves admin-entered data.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless`
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Node.js LTS server, modern browsers)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Billing sync completes within 30 seconds for 12 months of data; dashboard queries < 500ms
**Constraints**: GitHub API rate limits (5000 req/hr authenticated); serverless function timeout (60s default)
**Scale/Scope**: Single org billing, ~12-60 monthly billing snapshots, 3 modified files + 2 new UI components

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in strict TypeScript. Zod schemas for API responses. Exported types for all public interfaces. |
| II. UX Consistency | PASS | Uses existing shadcn/ui components (Table, Badge, Button, Tooltip). No new UI primitives needed. |
| III. Performance Budgets | PASS | No new routes/pages — extends existing Copilot billing page. Sync runs server-side, no bundle impact. |
| IV. Accessibility-First | PASS | New UI elements (conflict badges, linked period labels) use semantic HTML with ARIA attributes. |
| V. Simplicity & Maintainability | PASS | Extends existing sync pipeline rather than creating new abstraction. Vendor reference string convention for dedup — no new tables or complex patterns. |

All gates pass. No violations to justify.

### Post-Phase 1 Re-check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | `BillingLinkResult`, `BillingSyncConflict` types defined in contracts. Shared utility has exported type. |
| II. UX Consistency | PASS | Reuses existing Badge, Tooltip, Table components. Link status uses consistent color coding (green=linked, yellow=unlinked, red=conflict). |
| III. Performance Budgets | PASS | No new routes. Billing queries add one LEFT JOIN to existing dashboard queries — negligible impact. |
| IV. Accessibility-First | PASS | Conflict/unlinked badges include tooltip text for screen readers. Status column uses `aria-label`. |
| V. Simplicity & Maintainability | PASS | One extracted utility (`findActivePeriodForDate`), one new internal function (`syncBillingToBudget`), two new DB columns. Minimal surface area. |

No new violations introduced by design decisions.

## Project Structure

### Documentation (this feature)

```text
specs/015-github-billing/
├── plan.md              # This file
├── research.md          # Phase 0: API patterns, upsert strategy, conflict detection
├── data-model.md        # Phase 1: Schema changes (copilotBillingSnapshots, billedCosts)
├── quickstart.md        # Phase 1: Developer setup and testing guide
├── contracts/           # Phase 1: Server action interfaces
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── copilot-sync.ts          # MODIFY: Add billing-to-budget linking step in syncBillingData()
│   ├── copilot-api.ts           # MINOR: Type updates if needed for billing response
│   ├── db/
│   │   ├── schema.ts            # MODIFY: Add linkedBilledCostId back to copilotBillingSnapshots
│   │   └── migrations/          # NEW: Migration for schema changes
│   └── validators.ts            # MODIFY: Add billing sync config schema
├── actions/
│   ├── copilot.ts               # MODIFY: Update sync trigger to include billing linking
│   ├── copilot-data.ts          # MODIFY: Add budget context to billing queries
│   └── billing-sync.ts          # NEW: Conflict detection, manual sync trigger action
├── app/copilot/billing/
│   └── page.tsx                 # MODIFY: Add budget period column, conflict indicators
└── types/index.ts               # MODIFY: Add billing sync result types

tests/
├── unit/
│   └── billing-sync.test.ts     # NEW: Upsert logic, conflict detection, vendor ref generation
└── integration/
    └── billing-sync.test.ts     # NEW: Full sync pipeline with budget period matching
```

**Structure Decision**: Follows existing Next.js App Router structure. No new directories — extends existing `copilot-sync.ts` pipeline and `copilot/billing` page. One new action file (`billing-sync.ts`) for billing-specific logic that doesn't belong in the general copilot sync.

## Complexity Tracking

> No violations to track. All constitution gates pass.
