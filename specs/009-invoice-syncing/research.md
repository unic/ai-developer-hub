# Research: Invoice-to-Budget Period Sync

**Feature**: 009-invoice-syncing | **Date**: 2026-03-06

## R1: Extending Period Matching to Include Archived Budgets

**Decision**: Modify `findActivePeriodForDate` (or create a new `findPeriodForDate` variant) to query all budgets, ordering by status (active first) then by creation date (newest first).

**Rationale**: The current function filters `annualBudgets.status = 'active'` only. The sync feature requires matching invoices to periods in archived budgets too (e.g., invoices uploaded after a budget was archived). The existing ordering by `createdAt DESC` already handles tiebreaking; we just need to add status-based ordering so active budgets are preferred.

**Alternatives considered**:
- Separate queries for active then archived: Rejected — two round trips unnecessary; a single query with `CASE WHEN status = 'active' THEN 0 ELSE 1 END` ordering achieves the same result.
- Temporarily un-archiving budgets: Rejected — risky side effects on other features.

## R2: Batch Processing Strategy

**Decision**: Load all invoices with their linked billed costs and budget periods in a single query, then load all budget periods once. Process each invoice in-memory to determine its outcome, then execute DB mutations per-invoice.

**Rationale**: For 500 invoices, individual queries per invoice would create 500+ round trips. A bulk-load approach reduces this to 2 queries (all invoices + all budget periods), with mutations only for invoices that need changes.

**Alternatives considered**:
- Single massive transaction wrapping all changes: Rejected — a failure on one invoice would roll back all corrections. Per-invoice independence is a spec requirement (FR-008).
- Streaming/cursor-based processing: Rejected — unnecessary complexity for the expected scale (hundreds, not millions).

## R3: Concurrency Prevention

**Decision**: Use a client-side state lock (React state `isSyncing`) to prevent the sync button from being clicked while a sync is in progress. The server action itself is stateless and relies on the UI to prevent concurrent invocations.

**Rationale**: The sync is a single-user admin operation, not a multi-user concurrent scenario. A database-level lock (e.g., advisory lock) would add complexity for a scenario that doesn't occur in practice — only one admin triggers sync at a time.

**Alternatives considered**:
- Database advisory lock: Rejected — over-engineering for a single-admin scenario.
- Server-side in-memory lock: Rejected — doesn't survive serverless function cold starts.

## R4: Dry Run Implementation

**Decision**: The sync engine accepts a `dryRun: boolean` parameter. When true, it performs all the same matching logic but skips DB mutations, returning the same result structure. This reuses 100% of the matching code path.

**Rationale**: A single code path for both modes eliminates the risk of dry run results diverging from actual sync results (SC-006). The only difference is whether `db.insert`/`db.update`/`db.delete` calls are executed.

**Alternatives considered**:
- Separate dry-run function: Rejected — code duplication, risk of divergence.
- Database transaction with rollback: Rejected — wasteful and complex for a read-only preview.

## R5: Billed Cost Description Format

**Decision**: Reuse the existing format from `insertBilledCostDirect`: `"Invoice {invoiceNumber}"` or `"Invoice {invoiceNumber} — {vendor}"` when vendor is present. Set `vendorReference` to the invoice number.

**Rationale**: Consistency with billed costs created during upload. The sync should produce identical billed cost records to what would have been created if the budget period had existed at upload time.

**Alternatives considered**: None — consistency is the clear choice.

## R6: Invoice Listing Page Query Pattern

**Decision**: The sync results UI will be a client-side modal/panel shown after sync completes, not a separate page. The sync action returns all results in its response, and the client renders them immediately.

**Rationale**: The invoice listing page (`src/app/invoices/page.tsx`) already has action buttons in its header. Adding "Sync Invoices" follows the existing pattern. A modal for results keeps the user in context and avoids navigation.

**Alternatives considered**:
- Separate sync results page: Rejected — unnecessary route for transient data.
- Toast notifications only: Rejected — insufficient detail for the results summary requirement.

## R7: Transaction Scope for Corrections

**Decision**: Each invoice correction (delete old billed cost + create new billed cost + update invoice link) is wrapped in a single `db.transaction()`, consistent with the existing `overwriteInvoice` pattern.

**Rationale**: This ensures atomicity per-invoice while allowing other invoices to succeed or fail independently. The pattern is already proven in the codebase.

**Alternatives considered**: None — existing pattern is appropriate.
