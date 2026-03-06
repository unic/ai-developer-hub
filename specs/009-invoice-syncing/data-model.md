# Data Model: Invoice-to-Budget Period Sync

**Feature**: 009-invoice-syncing | **Date**: 2026-03-06

## Existing Entities (No Schema Changes)

This feature requires **no database schema changes**. All data is already modeled by existing tables. The sync operates on existing records using existing relationships.

### Invoice (existing: `invoices` table)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| invoiceNumber | varchar(255) | Indexed, used in billed cost description |
| invoiceDate | date | Used for period matching |
| amountCents | integer | Carried to billed cost |
| vendor | varchar(255), nullable | Carried to billed cost description |
| linkedBilledCostId | integer, nullable | FK to billed_costs; null = unlinked |
| blobUrl | text | Not used by sync |
| blobPathname | text | Not used by sync |
| uploadedBy | integer | FK to users |
| createdAt | timestamp | |
| updatedAt | timestamp | Updated on re-link |

### Billed Cost (existing: `billed_costs` table)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| periodId | integer | FK to budget_periods (cascade delete) |
| amountCents | integer | Copied from invoice |
| invoiceDate | date | Copied from invoice |
| description | varchar(500) | Format: "Invoice {num}" or "Invoice {num} — {vendor}" |
| vendorReference | varchar(255) | Set to invoiceNumber |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### Budget Period (existing: `budget_periods` table)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| budgetId | integer | FK to annual_budgets (cascade delete) |
| periodLabel | varchar(20) | e.g., "Jan 2026", "Q1 2026" |
| periodIndex | integer | 0-11 monthly, 0-3 quarterly |
| startDate | date | Inclusive lower bound |
| endDate | date | Exclusive upper bound |
| plannedAmountCents | integer | Not used by sync |

### Annual Budget (existing: `annual_budgets` table)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| fiscalYear | integer | Unique |
| totalAmountCents | integer | Not used by sync |
| periodType | enum('monthly','quarterly') | Not used by sync |
| status | enum('active','archived') | Used for priority ordering |
| createdAt | timestamp | Used for tiebreaking |

## New Transient Types (Not Persisted)

### SyncInvoiceOutcome

Represents the result of processing a single invoice during sync. Returned by the server action, never stored in the database.

| Field | Type | Description |
|-------|------|-------------|
| invoiceId | number | Invoice record ID |
| invoiceNumber | string | For display |
| invoiceDate | string | YYYY-MM-DD |
| amountCents | number | For display |
| vendor | string or null | For display |
| outcome | enum | One of: "verified", "newly_linked", "corrected", "unresolvable", "error" |
| previousPeriodLabel | string or null | Period label before sync (null if unlinked) |
| newPeriodLabel | string or null | Period label after sync (null if unresolvable) |
| reason | string or null | Explanation for unresolvable/error outcomes |

### SyncResult

Aggregate result returned by the sync server action.

| Field | Type | Description |
|-------|------|-------------|
| totalProcessed | number | Total invoices scanned |
| verified | number | Already correctly linked |
| newlyLinked | number | Were unlinked, now linked |
| corrected | number | Were linked to wrong period, now corrected |
| unresolvable | number | No matching period found |
| errors | number | Failed due to DB error |
| items | SyncInvoiceOutcome[] | Per-invoice details |

## Relationships Used by Sync

```
Invoice --[linkedBilledCostId]--> BilledCost --[periodId]--> BudgetPeriod --[budgetId]--> AnnualBudget
```

**Read path** (bulk load for matching):
- All invoices with their linked billed cost's period (left join chain)
- All budget periods with their parent budget status

**Write path** (per-invoice mutations):
- Insert new billed cost + update invoice.linkedBilledCostId (newly linked)
- Delete old billed cost + insert new billed cost + update invoice.linkedBilledCostId (corrected)
- No writes (verified / unresolvable)

## Date Matching Rule

A budget period **covers** an invoice date when:
```
budgetPeriod.startDate <= invoiceDate < budgetPeriod.endDate
```

Period selection priority:
1. Active budget periods (ordered by budget createdAt DESC)
2. Archived budget periods (ordered by budget createdAt DESC)
