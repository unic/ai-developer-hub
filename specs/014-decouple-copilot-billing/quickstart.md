# Quickstart: Decouple Copilot Billing from Budgets

**Feature**: `014-decouple-copilot-billing`
**Date**: 2026-03-09

## Prerequisites

- Node.js LTS, pnpm
- Database access (Neon PostgreSQL) with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` configured
- Feature branch `014-decouple-copilot-billing` checked out

## Setup

```bash
pnpm install
```

## Implementation Order

### Step 1: Modify Schema

Edit `src/lib/db/schema.ts`:
- Remove `linkedBilledCostId` column from `copilotBillingSnapshots` table definition
- Remove `copilot_billing_snapshots_linked_cost_idx` index
- Remove `linkedBilledCost` relation from `copilotBillingSnapshotsRelations`

### Step 2: Update Sync Pipeline

Edit `src/lib/copilot-sync.ts`:
- Remove `billedCosts` and `budgetPeriods` imports
- Remove budget period lookup and billedCosts creation from `syncBillingData()` (lines ~148-191)
- Remove entire `backfillBilledCosts()` function (lines ~513-570)
- Remove `backfillBilledCosts()` call from `runCopilotSync()` (lines ~650-655)
- Remove unused imports (`isNull`, `lte`, `gte` if no longer needed)

### Step 3: Generate and Customize Migration

```bash
pnpm db:generate
```

Then manually add a data cleanup statement to the generated migration:

```sql
DELETE FROM billed_costs WHERE vendor_reference LIKE 'copilot-billing-%';
```

### Step 4: Apply Migration

```bash
pnpm db:push    # Development
pnpm db:migrate # Production
```

### Step 5: Verify

```bash
pnpm typecheck  # Ensure no compile errors from removed column
pnpm lint       # Ensure clean
pnpm build      # Ensure production build works
```

## Verification Checklist

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero warnings
- [ ] `pnpm build` succeeds
- [ ] Copilot sync runs without errors (no budget dependency)
- [ ] Copilot billing page displays data from snapshots
- [ ] Reports page does not include Copilot cost entries
- [ ] Dashboard KPIs unaffected (they use licenseAssignments, not billedCosts)

## Key Files

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Remove linkedBilledCostId column, index, and relation |
| `src/lib/copilot-sync.ts` | Remove billing coupling logic and backfill function |
| `src/lib/db/migrations/` | New migration for column drop + data cleanup |
