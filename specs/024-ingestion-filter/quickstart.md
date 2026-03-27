# Quickstart: Invoice Ingestion Filters

**Branch**: `024-ingestion-filter` | **Date**: 2026-03-27

## Prerequisites

- Node.js LTS + pnpm installed
- Neon PostgreSQL database configured (`.env.local`)
- Project dependencies installed (`pnpm install`)

## Implementation Order

### 1. Schema + Migration

**Files**: `src/lib/db/schema.ts`, `src/lib/db/migrations/0016_*.sql`

Add to `schema.ts`:
- `filterFieldEnum` pgEnum: `["vendor", "invoice_number"]`
- `filterModeEnum` pgEnum: `["whitelist", "blacklist"]`
- `ingestionFilters` table with columns per data-model.md
- `filteredOut` boolean column on `invoices` table
- Extend `ingestionOutcomeEnum` to include `"filtered"`

Generate and apply migration:
```bash
pnpm db:generate
pnpm db:migrate
```

### 2. Validators

**File**: `src/lib/validators.ts`

Add Zod schemas:
- `vendorFilterValueSchema` — `{ values: string[] }`
- `invoiceNumberFilterValueSchema` — `{ pattern: string }` with RegExp validation
- `createIngestionFilterSchema` — full create input
- `updateIngestionFilterSchema` — partial update input
- `deleteIngestionFilterSchema` — `{ id: number }`

### 3. Filter Evaluation Engine

**File**: `src/lib/ingestion-filters.ts` (NEW)

Core function: `evaluateIngestionFilters(invoice)` → `FilterEvaluationResult`

Logic:
1. Query all enabled rules from `ingestionFilters` table, ordered by priority
2. Evaluate blacklist rules first — any match → filtered out
3. Evaluate whitelist rules with OR across fields — if whitelists exist and none match → filtered out
4. Return result with matched rule info

### 4. Logger Update

**File**: `src/lib/ingestion-logger.ts`

Extend `LogIngestionParams.outcome` type to `"success" | "failed" | "filtered"`.

### 5. Server Actions

**File**: `src/actions/ingestion-filters.ts` (NEW)

CRUD actions: `getIngestionFilters`, `createIngestionFilter`, `updateIngestionFilter`, `deleteIngestionFilter`, `toggleIngestionFilter`. All admin-only.

### 6. Integrate into Ingest Route

**File**: `src/app/api/invoices/ingest/route.ts`

Insert filter evaluation after extraction (line ~111) and before period lookup (line ~172). If filtered: create invoice with `filteredOut: true`, skip billedCosts, log as "filtered".

### 7. Integrate into saveInvoice

**File**: `src/actions/invoices.ts`

Insert filter evaluation after invoice DB insert (line ~368) and before period auto-link (line ~385). If filtered: update invoice with `filteredOut: true`, skip linking, log as "filtered".

### 8. Admin UI

**Files**:
- `src/app/settings/ingestion/ingestion-filters-section.tsx` (NEW) — filter management table + create/edit dialog
- `src/app/settings/ingestion/page.tsx` (MODIFY) — add filters section above history table
- `src/app/settings/ingestion/ingestion-history-table.tsx` (MODIFY) — add "filtered" to OutcomeBadge + faceted filter options

## Verification

```bash
pnpm typecheck        # Zero type errors
pnpm lint             # Zero warnings
pnpm test             # Unit tests pass (add tests for evaluateIngestionFilters)
pnpm build            # Production build succeeds
```

Manual verification:
1. Create a blacklist vendor rule → ingest matching invoice → verify stored but not budget-linked, shows "Filtered" in history
2. Create a whitelist vendor rule → ingest non-matching invoice → verify filtered
3. Disable rule → ingest same invoice → verify it passes through
4. Delete rule → verify previously filtered invoices unchanged
