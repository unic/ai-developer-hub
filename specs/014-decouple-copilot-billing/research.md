# Research: Decouple Copilot Billing from Budgets

**Date**: 2026-03-09
**Feature**: `014-decouple-copilot-billing`

## R-001: Current Billing Coupling Points

**Decision**: Remove three specific coupling points in the sync pipeline.

**Findings**:

The coupling exists in exactly three locations within `src/lib/copilot-sync.ts`:

1. **`syncBillingData()` (lines 148-191)**: After upserting a billing snapshot, the function looks up a matching budget period and creates a `billedCosts` entry. It then links the snapshot back via `linkedBilledCostId`. This is the primary coupling point.

2. **`backfillBilledCosts()` (lines 513-570)**: A standalone function that finds unlinked snapshots (where `linkedBilledCostId IS NULL`) and creates deferred `billedCosts` entries when matching budget periods are found later.

3. **`runCopilotSync()` (lines 650-655)**: Calls `backfillBilledCosts()` as a best-effort step after the three sync stages complete.

**Rationale**: These are the only write paths from Copilot sync to the shared billing system. Removing them cleanly decouples the two systems.

**Alternatives considered**:
- Soft-disable via feature flag: Rejected — adds complexity for a permanent decoupling
- Keep backfill but make it opt-in: Rejected — the future billing import feature will handle this properly

## R-002: Schema Column Removal Safety

**Decision**: Remove `linkedBilledCostId` column and its index from `copilotBillingSnapshots`.

**Findings**:

- **Column definition** (schema.ts lines 426-429): `linkedBilledCostId` is an optional FK to `billedCosts.id` with `SET NULL` on delete
- **Index** (schema.ts line 438): `copilot_billing_snapshots_linked_cost_idx` exists on this column
- **Relation** (schema.ts lines 591-594): `linkedBilledCost` relation defined in `copilotBillingSnapshotsRelations`
- **No downstream readers**: The Copilot billing page (`getCopilotBilling()` in copilot-data.ts) reads exclusively from `copilotBillingSnapshots` and never joins or references `billedCosts`
- **No other consumers**: No other action or page references `linkedBilledCostId`

**Rationale**: The column is write-only (set during sync, never queried for display). Safe to remove.

## R-003: Copilot Data in Shared Reports

**Decision**: Clean up existing Copilot `billedCosts` entries via migration; no code changes needed in reports.

**Findings**:

- **Dashboard KPIs** (`src/app/page.tsx`): Monthly spend is calculated from `licenseAssignments.costAtAssignmentCents`, NOT from `billedCosts`. Copilot seats contribute to this via `source="copilot-sync"` assignments — this is intentional and retained.
- **Reports page** (`src/app/reports/page.tsx`): Uses `getBilledCostsTimeSeries()` which aggregates ALL `billedCosts` entries per budget period. Copilot entries (with `vendorReference` matching `copilot-billing-*`) would be included if they exist.
- **Budget actions** (`src/actions/budget.ts`): `getBilledCostsTimeSeries()` has no filtering — it includes all rows unconditionally.

**Impact**: After removing the sync write path and cleaning up existing entries, Copilot costs will naturally disappear from reports without requiring code changes to the report queries.

**Rationale**: Data cleanup is simpler and safer than adding exclusion filters to every report query.

## R-004: Migration Strategy

**Decision**: Use Drizzle schema modification + `db:push` for development; generate migration for production.

**Findings**:

- **Drizzle config** (`drizzle.config.ts`): Schema in `./src/lib/db/schema.ts`, migrations output to `./src/lib/db/migrations/`
- **Existing migrations**: 7 files (0000-0006). The Copilot tables (copilotBillingSnapshots, copilotUsageMetrics) are defined in schema.ts but were added via `db:push` — no dedicated migration file exists for them yet.
- **Migration approach**: Modify schema.ts to remove the column, then generate a migration with `pnpm db:generate`. The migration SQL will handle the column drop and index removal. A separate SQL statement in the migration will delete orphaned `billedCosts` entries.

**Rationale**: Follows established project patterns. The migration handles both schema and data cleanup atomically.

## R-005: Type Definition Impact

**Decision**: Update TypeScript types after schema change — Drizzle infers types automatically.

**Findings**:

- **Type definitions** (`src/types/index.ts` lines 283-286): `CopilotBillingSnapshot` and `NewCopilotBillingSnapshot` are inferred from the schema via `InferSelectModel` / `InferInsertModel`
- **Impact**: Removing `linkedBilledCostId` from the schema will automatically remove it from the inferred types. No manual type changes needed.
- **Consumers**: Any code referencing `snapshot.linkedBilledCostId` will get a compile error, making it easy to find and remove all references.

**Rationale**: TypeScript strict mode ensures all references are caught at compile time.
