# Research: Invoice–Budget Integration

**Feature**: 007-invoice-budget-link
**Date**: 2026-03-05

---

## Decision 1: Zip Processing Library

**Decision**: Use `unzipper` (`pnpm add unzipper && pnpm add -D @types/unzipper`)

**Rationale**:
- Smallest bundle footprint (≈45 KB) among candidates — satisfies constitution performance budget
- Streaming architecture avoids loading entire zip into memory; critical for batches of many PDFs
- Promise-based entry API integrates cleanly with the existing `async/await` pattern in API routes
- `@types/unzipper` provides full TypeScript coverage; strict-mode compatible

**Alternatives considered**:
- `jszip` (167 KB, browser-first, loads entire zip in memory) — rejected: too heavy, no streaming
- `adm-zip` (121 KB, in-memory) — rejected: same memory concern as jszip
- `yazl/yauzl` (≈50 KB, streaming) — valid alternative but steeper API surface and two packages required
- Node.js built-in `zlib` — only handles gzip/deflate, not zip archives

**API route body size**: Next.js 15 App Router default body limit is 4 MB. A 50 MB zip cannot be parsed via `request.formData()` without first raising this limit. Solution: set `export const config` via a route segment override (`export const maxDuration = 60`) and stream the body directly using `request.body` rather than calling `request.formData()` for the bulk upload route. The single-file route is unaffected.

---

## Decision 2: DB Schema — FK Direction for Invoice ↔ Billed Cost Link

**Decision**: Add optional `linked_billed_cost_id` FK on the `invoices` table pointing to `billed_costs.id` with `ON DELETE SET NULL`.

**Rationale**:
- An invoice is a supporting document for a cost; the cost is the authoritative budget record
- FK on invoices: deleting a billed cost gracefully unlinks the invoice (SET NULL) without destroying the invoice record
- Matches existing pattern: `billedCosts` is the primary budget-domain entity; `invoices` is the document-domain entity
- Avoids polluting `billedCosts` with a document-management concern
- Allows future extension (multiple invoices per cost) without schema changes

**Alternatives considered**:
- FK on `billed_costs` pointing to `invoices` — rejected: mixes document and budget domains; harder to cascade safely
- Many-to-many join table — rejected: spec requires one cost per invoice (YAGNI)

**Migration**: New migration `0004_invoice_budget_link.sql` adds `vendor varchar(255)` and `linked_billed_cost_id integer REFERENCES billed_costs(id) ON DELETE SET NULL` to the `invoices` table.

---

## Decision 3: Period Matching Logic

**Decision**: Implement a new server-side utility `findActivePeriodForDate(invoiceDate: string)` that queries budget periods in a single DB call.

**Rationale**:
- No existing utility covers this. The `getBudgetWithCosts()` function fetches all periods in-memory but is designed for display, not lookup
- A targeted query (`WHERE startDate <= invoiceDate AND endDate > invoiceDate AND budget.status = 'active'`) is efficient and avoids loading the full budget tree
- Returns the single period (if any) whose date range contains the invoice date, preferring the most recently created active budget if multiple overlap

**Boundary rule**: The period whose `startDate <= invoiceDate < endDate` is chosen. The invoice date is compared as an ISO string (PostgreSQL date comparison), consistent with how the schema stores dates.

**No-match behaviour**: If no active period covers the date, the invoice is saved without a linked cost; the UI shows a notice per FR-003.

---

## Decision 4: Vendor Field in Extraction

**Decision**: Add `vendor` as an optional field to the existing Claude tool schema in `invoice-extraction.ts`. Add `vendor` confidence to the confidence object. Update `invoiceExtractionResultSchema` and `createInvoiceSchema` accordingly.

**Rationale**:
- The Claude extraction tool already uses forced tool-use for structured output; adding one field reuses the entire pipeline with minimal change
- Vendor is nullable (not all PDFs have a clear company name); confidence indicator is consistent with existing fields
- The regex fallback can attempt a simple company-name heuristic (e.g. looking for patterns like "From: CompanyName" or a capitalised proper noun near the header) but will default to `null`/`low` confidence

---

## Decision 5: Batch Upload Architecture

**Decision**: Two-step batch flow: (1) `POST /api/invoices/bulk-upload` extracts all PDFs from the zip and runs field extraction, returning an array of draft invoice objects; (2) `saveBulkInvoices` server action saves confirmed invoices and triggers auto-linking.

**Rationale**:
- Separating extraction from persistence matches the existing single-file UX (extract → review → confirm)
- Allows the admin to correct any field before committing, per FR-008
- Keeps each save atomic: a failure on one invoice does not roll back others
- The batch review screen is a client component that renders a table of extracted results using TanStack Table (already installed)

**Max batch size**: 50 PDFs enforced at the API route level (reject zip with > 50 PDF entries). Zip must be ≤ 50 MB.
