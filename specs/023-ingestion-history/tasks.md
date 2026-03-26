# Tasks: Ingestion History Tab

**Input**: Design documents from `/specs/023-ingestion-history/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md

**Tests**: Not explicitly requested — no test tasks included.

**Organization**: Tasks grouped by user story. US1 (Browse History) and US2 (Error Details) are combined as both P1 and tightly coupled (same table component). US4 (Navigation) is foundational since the tab must exist before the table can be accessed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions
- **Commit after each task or logical group** per user request

## Phase 1: Setup (Schema & Shared Components)

**Purpose**: Database schema changes and component promotion for reuse

- [x] T001 Add `ingestion_outcome` enum (`success`, `failed`), `ingestion_channel` enum (`manual`, `api`, `bulk`), and `ingestion_log` table with all columns, indexes, and relations to `src/lib/db/schema.ts` per data-model.md
- [x] T002 Generate migration by running `pnpm db:generate` — verify `0014_add_ingestion_log.sql` is created in `src/lib/db/migrations/`
- [x] T003 [P] Move `ErrorPopover` from `src/app/settings/sync/error-popover.tsx` to `src/components/error-popover.tsx` (keep same component API)
- [x] T004 [P] Move `OutcomeBadge` from `src/app/settings/sync/outcome-badge.tsx` to `src/components/outcome-badge.tsx` (keep same component API)
- [x] T005 Update imports in `src/app/settings/sync/scheduled-jobs-table.tsx` and `src/app/settings/sync/manual-jobs-table.tsx` to reference moved `ErrorPopover` and `OutcomeBadge` from `src/components/`

**Checkpoint**: Schema ready, shared components promoted. Commit: "feat(023): add ingestion_log schema and promote shared components"

---

## Phase 2: Foundational (Server Action & Navigation)

**Purpose**: Core infrastructure that MUST be complete before the UI can be built

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 [US4] Add `{ label: "Ingestion", href: "/settings/ingestion" }` to `adminTabs` array in `src/app/settings/settings-nav.tsx`
- [x] T007 Create `logIngestionAttempt` helper function in `src/actions/ingestion-log.ts` that inserts a row into `ingestion_log` table — accepts params: `{ filename?, vendor?, invoiceNumber?, invoiceDate?, amountCents?, outcome, errorMessage?, channel, blobPathname?, linkedInvoiceId?, uploadedBy? }`
- [x] T008 Create `getIngestionHistory` server action in `src/actions/ingestion-log.ts` that queries `ingestion_log` joined with `users` (for uploader name), returns `IngestionLogRow[]` sorted by `created_at` desc — per contracts/api-contracts.md

**Checkpoint**: Navigation and data layer ready. Commit: "feat(023): add ingestion nav tab and server actions"

---

## Phase 3: User Story 1 + 2 — Browse Ingestion History & Error Details (Priority: P1)

**Goal**: Administrators can view all ingestion attempts in a filterable, sortable table with clickable error details for failed ingestions.

**Independent Test**: Navigate to Settings > Ingestion, verify the table loads with columns for status, vendor, invoice number, date, amount, uploader, channel, timestamp. Click a column header to sort. Use faceted filters for status and vendor. Click a failed row's error text to see the full error in a popover.

### Implementation

- [x] T009 [US1] Create admin-gated server page at `src/app/settings/ingestion/page.tsx` — call `requireAdmin()`, fetch data via `getIngestionHistory()`, render `IngestionHistoryTable` component
- [x] T010 [US1] Create `src/app/settings/ingestion/ingestion-history-table.tsx` client component with TanStack Table `ColumnDef<IngestionLogRow>[]` including: OutcomeBadge for status, invoice number, vendor (fallback "Unknown" for null), date, amount (formatted as currency), channel, uploader name (fallback "API" for null), created_at timestamp, ErrorPopover for error column. Configure `DataTable` with `facetedFilters` for outcome and vendor columns. Include empty state message with guidance when no records exist.

**Checkpoint**: Core table functional with error details. Commit: "feat(023): add ingestion history table with error popovers"

---

## Phase 4: User Story 3 — Download Ingested Document (Priority: P2)

**Goal**: Administrators can download the original PDF for any successfully ingested document directly from the table.

**Independent Test**: Click the download button on a successful ingestion row — browser downloads the PDF. Verify the button is disabled/hidden for failed ingestions (no `linkedInvoiceId`).

### Implementation

- [x] T011 [US3] Add download action column to `src/app/settings/ingestion/ingestion-history-table.tsx` — render a `Download` icon button linking to `/api/invoices/{linkedInvoiceId}/pdf` when `linkedInvoiceId` is non-null; render disabled button with tooltip "No document available" when null

**Checkpoint**: Download functionality complete. Commit: "feat(023): add document download to ingestion history"

---

## Phase 5: Ingestion Logging Hooks

**Purpose**: Instrument all three ingestion channels to write to `ingestion_log` so the history table has data.

- [x] T012 Instrument `src/app/api/invoices/ingest/route.ts` — call `logIngestionAttempt` with `channel: "api"` on both success (with `linkedInvoiceId`) and all error paths (400, 409, 422 with `errorMessage`). Use the original filename from `file.name`, extracted fields where available.
- [x] T013 [P] Instrument `saveInvoice` in `src/actions/invoices.ts` — call `logIngestionAttempt` with `channel: "manual"` after successful invoice creation, passing the new invoice ID as `linkedInvoiceId`
- [x] T014 [P] Instrument `saveBulkInvoices` in `src/actions/invoices.ts` — call `logIngestionAttempt` with `channel: "bulk"` for each item in the batch, logging both successes (with `linkedInvoiceId`) and failures/skips (with `errorMessage`)

**Checkpoint**: All ingestion channels now log to `ingestion_log`. Commit: "feat(023): instrument ingestion channels with logging"

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation, cleanup, and verification

- [x] T015 Run `pnpm typecheck` and fix any TypeScript errors across all modified files
- [x] T016 [P] Run `pnpm lint` and fix any ESLint warnings across all modified files
- [x] T017 Apply migration with `pnpm db:migrate` and verify the ingestion history page loads at `/settings/ingestion` per quickstart.md validation steps

**Checkpoint**: Feature complete. Commit: "feat(023): polish and verify ingestion history tab"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist for server actions)
- **US1+US2 (Phase 3)**: Depends on Phase 2 (server action and nav tab must exist)
- **US3 (Phase 4)**: Depends on Phase 3 (table must exist to add download column)
- **Logging Hooks (Phase 5)**: Depends on Phase 2 (logIngestionAttempt must exist) — can run in parallel with Phases 3-4
- **Polish (Phase 6)**: Depends on all previous phases

### User Story Dependencies

- **US4 (Navigation)**: Foundational — done in Phase 2, no story dependencies
- **US1+US2 (Browse + Errors)**: Depends on Phase 2 only — no other story dependencies
- **US3 (Download)**: Depends on US1 table component existing

### Parallel Opportunities

**Within Phase 1**:
```
T001 (schema) → T002 (generate migration)
T003 (move ErrorPopover) ∥ T004 (move OutcomeBadge)  # parallel
T005 (update imports) after T003 + T004
```

**Phase 5 can run in parallel with Phases 3-4**:
```
Phase 3 (table UI) ∥ T012 (API hook) ∥ T013 (manual hook) ∥ T014 (bulk hook)
```

---

## Implementation Strategy

### MVP First (Phase 1 → 2 → 3)

1. Complete Phase 1: Setup (schema + shared components)
2. Complete Phase 2: Foundational (nav tab + server actions)
3. Complete Phase 3: US1+US2 (the table with error details)
4. **STOP and VALIDATE**: Table shows ingestion history with filtering, sorting, error popovers
5. This delivers SC-001, SC-002, SC-004, SC-005

### Incremental Delivery

1. Setup + Foundational → Schema and navigation ready
2. US1+US2 → Browsable, filterable history with error details → **MVP!**
3. US3 → Document downloads → Audit capability complete
4. Logging Hooks → All channels write to ingestion_log → Full data pipeline
5. Polish → Type-safe, lint-clean, verified

### Commit Strategy (per user request)

Commit after each phase checkpoint:
1. `feat(023): add ingestion_log schema and promote shared components`
2. `feat(023): add ingestion nav tab and server actions`
3. `feat(023): add ingestion history table with error popovers`
4. `feat(023): add document download to ingestion history`
5. `feat(023): instrument ingestion channels with logging`
6. `feat(023): polish and verify ingestion history tab`

---

## Notes

- No new npm packages required — all dependencies already installed
- Monetary amounts displayed in dollars (converted from cents) using existing currency formatter
- Empty vendor fields display "Unknown" fallback per edge case spec
- ErrorPopover and OutcomeBadge are moved to shared location, not copied — single source of truth
- Migration uses Drizzle's idempotent DO blocks with `IF NOT EXISTS` guards per codebase convention
