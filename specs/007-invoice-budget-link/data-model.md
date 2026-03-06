# Data Model: Invoice–Budget Integration

**Feature**: 007-invoice-budget-link
**Date**: 2026-03-05

---

## Schema Changes

### Modified: `invoices` table

Two new nullable columns added to the existing table.

| Column | Type | Nullable | Constraint |
|--------|------|----------|------------|
| `vendor` | `varchar(255)` | YES | — |
| `linked_billed_cost_id` | `integer` | YES | FK → `billed_costs.id` ON DELETE SET NULL |

**Index**: `invoices_linked_billed_cost_id_idx` on `linked_billed_cost_id`

**Relations update**:
- Add `linkedBilledCost: one(billedCosts)` to `invoicesRelations`
- Add `invoices: many(invoices)` to `billedCostsRelations`

### No changes to: `billed_costs`, `budget_periods`, `annual_budgets`

All auto-created billed cost entries use the existing `createBilledCost` server action. No new columns required on any other table.

---

## Updated TypeScript Types

### `InvoiceExtractionResult` (src/lib/validators.ts)

```typescript
// Add vendor field
export const invoiceExtractionResultSchema = z.object({
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  amountCents: z.number().int().positive().nullable(),
  vendor: z.string().nullable(),                          // NEW
  confidence: z.object({
    invoiceNumber: z.enum(["high", "medium", "low"]),
    invoiceDate: z.enum(["high", "medium", "low"]),
    amountCents: z.enum(["high", "medium", "low"]),
    vendor: z.enum(["high", "medium", "low"]),            // NEW
  }),
});
```

### `createInvoiceSchema` (src/lib/validators.ts)

```typescript
export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(255),
  invoiceDate: z.string().regex(...).refine(...),
  amountCents: z.number().int().positive(),
  vendor: z.string().max(255).optional(),                 // NEW
  blobUrl: z.string().url(),
  blobPathname: z.string().min(1),
});
```

---

## New Utility Function

### `findActivePeriodForDate` (src/lib/budget-utils.ts or inline in src/actions/invoices.ts)

```typescript
async function findActivePeriodForDate(
  invoiceDate: string  // YYYY-MM-DD
): Promise<{ periodId: number; periodLabel: string } | null>
```

**Query logic**: Join `budget_periods` ↔ `annual_budgets` where:
- `annual_budgets.status = 'active'`
- `budget_periods.start_date <= invoiceDate`
- `budget_periods.end_date > invoiceDate`
- Order by `annual_budgets.created_at DESC`, take first

---

## Auto-Linking Logic (src/actions/invoices.ts — `saveInvoice`)

After the invoice DB row is inserted, the `saveInvoice` action runs the following additional steps:

1. Call `findActivePeriodForDate(invoiceDate)`
2. If period found:
   - Build description: `"Invoice {invoiceNumber}"` + ` — {vendor}` if vendor present
   - Call internal `createBilledCostDirect({ periodId, amountCents, invoiceDate, description, vendorReference: invoiceNumber })`
   - Update invoice row: `SET linked_billed_cost_id = newCostId WHERE id = newInvoiceId`
   - Return `{ success: true, data: { id }, linkedPeriodLabel: period.periodLabel }`
3. If no period found:
   - Return `{ success: true, data: { id }, linkWarning: "No active budget period covers this invoice date." }`

> Note: `createBilledCostDirect` is an internal DB-level function that bypasses the admin re-auth check (auth already validated at the top of `saveInvoice`). The public `createBilledCost` server action is unchanged.

---

## Batch Processing Data Flow

```
POST /api/invoices/bulk-upload (zip)
  │
  ├─ Unzip entries (unzipper, buffered)
  ├─ For each PDF entry (max 50):
  │    ├─ Upload PDF bytes → R2  (objectKey, blobUrl)
  │    └─ Run extractInvoiceFields(objectKey)
  │         → ExtractionDraft { objectKey, blobUrl, ...fields, confidence, error? }
  │
  └─ Return: BulkExtractionResult[]

Client: Bulk Review Table (TanStack Table)
  └─ Admin corrects fields → submit

saveBulkInvoices(invoices: CreateInvoiceInput[])
  └─ For each: saveInvoice(invoice)  →  { id, linkedPeriodLabel?, linkWarning? }
  └─ Return: BulkSaveResult[]
```

---

## Migration File

**File**: `src/lib/db/migrations/0004_powerful_virginia_dare.sql`

```sql
ALTER TABLE "invoices" ADD COLUMN "vendor" varchar(255);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "linked_billed_cost_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_linked_billed_cost_id_billed_costs_id_fk"
    FOREIGN KEY ("linked_billed_cost_id") REFERENCES "public"."billed_costs"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX "invoices_linked_billed_cost_id_idx" ON "invoices" ("linked_billed_cost_id");
```
