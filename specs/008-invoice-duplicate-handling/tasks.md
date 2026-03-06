# Tasks: Invoice Duplicate Handling & Amount Display

**Input**: Design documents from `/specs/008-invoice-duplicate-handling/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks grouped by user story. No new files or schema changes; all work modifies 3 existing files + 1 action file.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No project setup needed — existing codebase, no new dependencies, no schema changes.

_Phase skipped — all infrastructure already exists._

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server-side actions that US1 and US2 both depend on. Must complete before user story work.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 [P] Add `checkInvoiceDuplicate` server action that queries by invoice number and returns existing invoice details (id, invoiceNumber, invoiceDate, amountCents, vendor, linkedBilledCostId) in `src/actions/invoices.ts`
- [x] T002 [P] Add `checkBulkDuplicates` server action that accepts an array of invoice numbers and returns a map of duplicates (keyed by invoice number) with existing invoice details in `src/actions/invoices.ts`
- [x] T003 [P] Add `cleanupBlob` internal helper function that deletes an R2 object by blobPathname using the existing DeleteObjectCommand pattern (best-effort, swallow errors) in `src/actions/invoices.ts`
- [x] T004 Remove the soft duplicate check (lines 102-106) and the duplicate warning return (line 171) from `saveInvoice` in `src/actions/invoices.ts` — duplicate detection is now handled separately before save

**Checkpoint**: Foundation ready — all three user stories can now proceed.

---

## Phase 3: User Story 1 — Duplicate Detection on Single Upload (Priority: P1) MVP

**Goal**: When an admin uploads a single invoice whose number matches an existing record, they see a dialog with the existing invoice details and can choose to skip (cancel) or overwrite (replace the existing invoice and its linked billed cost).

**Independent Test**: Upload an invoice with a number that already exists. Verify the duplicate dialog appears with existing details. Choose "Skip" and confirm nothing changes. Re-upload and choose "Overwrite" — confirm the existing record and billed cost are updated.

### Implementation for User Story 1

- [ ] T005 [US1] Add `overwriteInvoice` server action in `src/actions/invoices.ts` that: (a) fetches existing invoice with old blobPathname and linkedBilledCostId, (b) updates invoice row (date, amount, vendor, blobUrl, blobPathname, updatedAt), (c) deletes old R2 blob via `cleanupBlob`, (d) handles linked billed cost: update in place if same period, or delete old + create new if period changed, or attempt auto-link if no prior link, (e) returns success with linkedPeriodLabel/linkWarning
- [ ] T006 [US1] Add duplicate check call in `src/app/invoices/new/invoice-upload-form.tsx` — after extraction completes and form fields are populated, call `checkInvoiceDuplicate` with the extracted invoice number; store the result (isDuplicate + existingInvoice) in component state
- [ ] T007 [US1] Build duplicate resolution dialog in `src/app/invoices/new/invoice-upload-form.tsx` — use shadcn AlertDialog showing existing invoice details (number, date, amount formatted as dollars via `formatCurrency`, vendor), with "Skip (Cancel Upload)" and "Overwrite Existing" action buttons
- [ ] T008 [US1] Wire "Skip" action in duplicate dialog in `src/app/invoices/new/invoice-upload-form.tsx` — call `cleanupBlob` with the new upload's blobPathname, reset form state and upload state to idle, show toast confirming skip
- [ ] T009 [US1] Wire "Overwrite" action in duplicate dialog in `src/app/invoices/new/invoice-upload-form.tsx` — call `overwriteInvoice` with existingInvoice.id and current form data (converting amountDollars to cents if US3 is done, otherwise using amountCents), handle success/error toasts and redirect to /invoices
- [ ] T010 [US1] Add re-check on invoice number field blur in `src/app/invoices/new/invoice-upload-form.tsx` — when admin manually edits the invoice number field and it loses focus, re-run `checkInvoiceDuplicate` and update the duplicate state so the dialog triggers on submit if a match is found

**Checkpoint**: Single upload duplicate detection fully functional — skip and overwrite both work.

---

## Phase 4: User Story 2 — Duplicate Handling in Bulk Upload (Priority: P2)

**Goal**: In a bulk zip upload, duplicates (both DB matches and within-batch) are flagged on the review screen and auto-skipped on save. The outcome summary distinguishes saved, skipped, and failed invoices.

**Independent Test**: Upload a zip with 5 PDFs — 2 matching existing invoice numbers, 1 sharing a number with another in the batch. Verify the review screen flags all 3 duplicates. Submit and confirm only 2 new invoices are saved; skipped items show in the summary.

### Implementation for User Story 2

- [ ] T011 [US2] Integrate `checkBulkDuplicates` into the bulk upload flow in `src/app/invoices/bulk/bulk-upload-form.tsx` — after zip extraction results arrive, collect all extracted invoice numbers, call `checkBulkDuplicates`, and store the duplicates map in component state
- [ ] T012 [US2] Add within-batch duplicate detection in `src/app/invoices/bulk/bulk-upload-form.tsx` — scan the extraction results client-side for repeated invoice numbers; mark second+ occurrences as within-batch duplicates in row state
- [ ] T013 [US2] Add visual duplicate flags to the review table in `src/app/invoices/bulk/bulk-upload-form.tsx` — add a "Status" column; show "Duplicate — will be skipped" badge with warning icon for DB-match and within-batch duplicates; make flagged rows visually muted (reduced opacity or strikethrough styling); make flagged rows non-editable
- [ ] T014 [US2] Modify `saveBulkInvoices` in `src/actions/invoices.ts` to accept an optional `skip` boolean and `skipReason` string per item; skipped items have their R2 blobs cleaned up via `cleanupBlob` and are returned in outcomes with `skipped: true` and `skipReason`
- [ ] T015 [US2] Update the batch submit handler in `src/app/invoices/bulk/bulk-upload-form.tsx` to pass `skip: true` and `skipReason: "duplicate"` or `"within-batch-duplicate"` for flagged rows when calling `saveBulkInvoices`
- [ ] T016 [US2] Update the outcome summary (done state) in `src/app/invoices/bulk/bulk-upload-form.tsx` to show three categories: saved (with invoice ID and period), skipped (with reason), and failed (with error); include counts for each category

**Checkpoint**: Bulk upload duplicate handling complete — duplicates flagged on review, skipped on save, reported in summary.

---

## Phase 5: User Story 3 — Display Invoice Amount in Dollars (Priority: P3)

**Goal**: All invoice upload and review forms display amounts in dollars ($125.00) instead of raw cents (12500). Storage remains in cents.

**Independent Test**: Upload a PDF invoice. Verify the amount field shows "125.00" (not "12500") with a dollar label. Edit to "250.50", save, and confirm the database stores 25050 cents.

### Implementation for User Story 3

- [ ] T017 [P] [US3] Change the amount field in the single upload form in `src/app/invoices/new/invoice-upload-form.tsx` — change label from "Amount (cents)" to "Amount ($)", change placeholder from "e.g. 12500 for $125.00" to "0.00", add `step="0.01"` and `min="0.01"` to the input, use a local `amountDollars` form field instead of `amountCents`
- [ ] T018 [P] [US3] Add cents-to-dollars conversion after extraction in `src/app/invoices/new/invoice-upload-form.tsx` — when extraction returns `amountCents`, set form value to `(amountCents / 100).toFixed(2)`; on form submit, convert back with `Math.round(parseFloat(amountDollars) * 100)` before passing to `saveInvoice` or `overwriteInvoice`
- [ ] T019 [P] [US3] Change the amount column in the bulk review table in `src/app/invoices/bulk/bulk-upload-form.tsx` — display extracted amounts as dollars (divide by 100), change the ARIA label from "Amount in cents" to "Amount in dollars", update the input to use `step="0.01"`, convert back to cents on batch submit
- [ ] T020 [US3] Update the duplicate dialog in `src/app/invoices/new/invoice-upload-form.tsx` to display the existing invoice's amount using `formatCurrency` (already divides cents by 100) rather than raw cents

**Checkpoint**: All amount displays show dollars. Storage unchanged at cents.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all stories.

- [ ] T021 Verify all amount displays are consistent across single upload form, bulk review table, duplicate dialog, and outcome summary — spot-check with `formatCurrency` from `src/lib/utils.ts`
- [ ] T022 Run `pnpm typecheck` and `pnpm lint` to confirm zero errors and zero warnings across all modified files
- [ ] T023 Run `pnpm build` to confirm production build succeeds with no errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped — no setup required
- **Foundational (Phase 2)**: No dependencies — can start immediately
- **User Story 1 (Phase 3)**: Depends on Phase 2 (needs `checkInvoiceDuplicate`, `cleanupBlob`)
- **User Story 2 (Phase 4)**: Depends on Phase 2 (needs `checkBulkDuplicates`, `cleanupBlob`). Independent of US1.
- **User Story 3 (Phase 5)**: No dependencies on Phase 2. Can start in parallel with US1/US2. However, T020 depends on T007 (duplicate dialog must exist before updating its amount display).
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Requires T001, T003, T004 from Phase 2. Independent of US2 and US3.
- **US2 (P2)**: Requires T002, T003, T004 from Phase 2. Independent of US1 and US3.
- **US3 (P3)**: Mostly independent. T017-T019 can run any time. T020 requires T007 (duplicate dialog from US1).

### Within Each User Story

- US1: T005 (overwrite action) → T006 (duplicate check in form) → T007 (dialog) → T008, T009 (wire actions, parallel) → T010 (blur re-check)
- US2: T011 (bulk check integration) → T012 (within-batch detection) → T013 (visual flags) → T014 (server skip support) → T015 (submit handler) → T016 (outcome summary)
- US3: T017, T018, T019 (all parallel, different sections of different files) → T020 (depends on T007)

### Parallel Opportunities

- **Phase 2**: T001, T002, T003 can all run in parallel (independent functions in same file, no conflicts if written as additions)
- **US1 + US2**: Can proceed in parallel after Phase 2 (different UI files)
- **US3 T017-T019**: Can run in parallel with each other (T017/T018 touch single form, T019 touches bulk form)
- **US1 T008 + T009**: Can run in parallel (independent button handlers)

---

## Parallel Example: Phase 2

```text
# Launch all foundational tasks together (all are additions to src/actions/invoices.ts):
Task T001: "Add checkInvoiceDuplicate server action in src/actions/invoices.ts"
Task T002: "Add checkBulkDuplicates server action in src/actions/invoices.ts"
Task T003: "Add cleanupBlob helper in src/actions/invoices.ts"
```

## Parallel Example: US1 + US2 After Phase 2

```text
# These can proceed simultaneously (different files):
Agent A (US1): T005-T010 in src/app/invoices/new/invoice-upload-form.tsx + src/actions/invoices.ts
Agent B (US2): T011-T016 in src/app/invoices/bulk/bulk-upload-form.tsx + src/actions/invoices.ts
```

## Parallel Example: US3 Amount Display

```text
# All three amount display tasks can run in parallel:
Task T017: "Change amount field in src/app/invoices/new/invoice-upload-form.tsx"
Task T018: "Add cents-to-dollars conversion in src/app/invoices/new/invoice-upload-form.tsx"
Task T019: "Change amount column in src/app/invoices/bulk/bulk-upload-form.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T004)
2. Complete Phase 3: User Story 1 (T005-T010)
3. **STOP and VALIDATE**: Test single upload duplicate detection independently
4. Deploy/demo if ready — admins can now skip or overwrite duplicates on single uploads

### Incremental Delivery

1. Phase 2 → Foundation ready
2. US1 (Phase 3) → Single upload duplicate handling → Deploy (MVP)
3. US2 (Phase 4) → Bulk upload duplicate handling → Deploy
4. US3 (Phase 5) → Dollar amount display → Deploy
5. Polish (Phase 6) → Final validation → Deploy

### Parallel Team Strategy

With multiple developers or agents:

1. Complete Phase 2 together (4 tasks, all in same file)
2. Once Phase 2 is done:
   - Agent A: US1 (single upload form + overwrite action)
   - Agent B: US2 (bulk upload form + skip logic)
   - Agent C: US3 T017-T019 (amount display, both forms)
3. Converge for T020 (US3 depends on US1 dialog) and Phase 6 polish

---

## Notes

- No database schema changes — all modifications are application-level
- `invoiceNumber` stays non-unique at DB level; enforcement is application-level with user choice
- R2 blob cleanup is always best-effort (swallow errors)
- Dollar↔cents conversion is UI-only; Zod schema (`createInvoiceSchema`) stays as `amountCents: z.number().int().positive()`
- Overwrite is update-in-place (preserves invoice ID and audit history)
- Bulk upload offers skip only (no per-row overwrite) — admins re-upload individually to overwrite
