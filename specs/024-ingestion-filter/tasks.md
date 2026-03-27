# Tasks: Invoice Ingestion Filters

**Input**: Design documents from `/specs/024-ingestion-filter/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/server-actions.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Commit strategy**: Commit after each task or logical group. Each commit should leave the codebase in a buildable state.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Schema & Migration)

**Purpose**: Database schema changes and migration — the foundation all other work depends on.

- [x] T001 Add `filterFieldEnum` ("vendor", "invoice_number") and `filterModeEnum` ("whitelist", "blacklist") pgEnums to `src/lib/db/schema.ts`
- [x] T002 Add `ingestionFilters` table definition to `src/lib/db/schema.ts` with columns: id, name, field, mode, value (jsonb), enabled, priority, created_by (FK users), created_at, updated_at; add index on enabled
- [x] T003 Add `filteredOut` boolean column (default false) to the `invoices` table in `src/lib/db/schema.ts`
- [x] T004 Extend `ingestionOutcomeEnum` to add "filtered" value in `src/lib/db/schema.ts`
- [x] T005 Generate and review migration file via `pnpm db:generate` — verify it creates the new enums, new table, alters invoices, and extends ingestion_outcome; make migration idempotent following the pattern in `0015_add_ingestion_log.sql`
- [x] T006 Apply migration via `pnpm db:migrate` and verify with `pnpm typecheck`

**Commit**: Schema and migration for ingestion filters

---

## Phase 2: Foundational (Validators, Logger, Evaluation Engine)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T007 [P] Add Zod schemas to `src/lib/validators.ts`: `vendorFilterValueSchema` ({ values: string[] }), `invoiceNumberFilterValueSchema` ({ pattern: string } with RegExp try-catch validation), `createIngestionFilterSchema`, `updateIngestionFilterSchema`, `deleteIngestionFilterSchema`; export inferred types
- [x] T008 [P] Extend `LogIngestionParams.outcome` type to `"success" | "failed" | "filtered"` in `src/lib/ingestion-logger.ts`
- [x] T009 Create filter evaluation engine in `src/lib/ingestion-filters.ts` (NEW): export `evaluateIngestionFilters(invoice: { vendor: string | null; invoiceNumber: string })` that queries all enabled rules from `ingestionFilters` ordered by priority, evaluates blacklist first (any match → filtered), then whitelist with OR across fields, returns `{ filteredOut: boolean; matchedRule: { id, name, field, mode } | null; reason: string | null }`
- [x] T010 Run `pnpm typecheck` and `pnpm lint` to verify foundation compiles cleanly

**Commit**: Validators, logger extension, and filter evaluation engine

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Admin creates a blacklist filter rule (Priority: P1) MVP

**Goal**: Admin can create a blacklist vendor rule. Matching invoices are stored but excluded from budget linking and marked as filtered.

**Independent Test**: Create a blacklist vendor rule, ingest a matching invoice via API, verify invoice is stored with `filtered_out = true`, not linked to any budget period, and logged with outcome "filtered".

### Implementation for User Story 1

- [x] T011 [P] [US1] Create CRUD server actions in `src/actions/ingestion-filters.ts` (NEW): `getIngestionFilters()`, `createIngestionFilter(input)`, `deleteIngestionFilter(id)` — all admin-only via `requireAdmin()`, validate with Zod schemas, `revalidatePath("/settings/ingestion")`
- [x] T012 [P] [US1] Create filter management UI component in `src/app/settings/ingestion/ingestion-filters-section.tsx` (NEW): "use client" component with DataTable listing rules (name, field, mode, enabled, priority, created by), a "New Filter" button opening a Sheet/Dialog with form fields (name, field selector, mode selector, vendor values input), and delete button per row
- [x] T013 [US1] Integrate filter evaluation into the API ingest route in `src/app/api/invoices/ingest/route.ts`: after extraction (line ~111) and duplicate check (line ~157), call `evaluateIngestionFilters()`. If filtered: still upload to R2, create invoice with `filteredOut: true` and `linkedBilledCostId: null`, skip `findPeriodForDate` and `billedCosts` insert, log with outcome "filtered" and reason in errorMessage, return 200 with `status: "filtered"`
- [x] T014 [US1] Integrate filter evaluation into `saveInvoice` in `src/actions/invoices.ts`: after invoice DB insert (line ~368) and before budget period auto-link (line ~385), call `evaluateIngestionFilters()`. If filtered: update invoice with `filteredOut: true`, log with outcome "filtered", skip `findActivePeriodForDate` + `insertBilledCostDirect`, return success with `filterWarning`
- [x] T015 [US1] Add "Filters" section to the ingestion settings page in `src/app/settings/ingestion/page.tsx`: import and render `IngestionFiltersSection` above the existing `IngestionHistoryTable`, pass filter data from `getIngestionFilters()` server action
- [x] T016 Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` to verify US1 compiles

**Commit**: Blacklist filter rules — CRUD, evaluation, integration into all ingest paths

**Checkpoint**: User Story 1 should be fully functional — blacklist vendor rules block budget linking.

---

## Phase 4: User Story 2 — Admin creates a whitelist filter rule (Priority: P1)

**Goal**: Admin can create whitelist rules. Only invoices matching at least one whitelist field pass through to budget linking.

**Independent Test**: Create a whitelist vendor rule with ["Anthropic"], ingest an invoice from "Staples", verify it is filtered. Ingest an invoice from "Anthropic", verify it passes through.

### Implementation for User Story 2

- [x] T017 [US2] Verify whitelist evaluation logic in `src/lib/ingestion-filters.ts` handles OR across fields correctly: if whitelist rules exist and invoice matches any one field's whitelist → passes; if none match across all fields → filtered out. Add handling for combined whitelist + blacklist (blacklist takes precedence per FR-007). No new files — this should already be implemented in T009, verify edge cases.
- [x] T018 [US2] Update the create filter form in `src/app/settings/ingestion/ingestion-filters-section.tsx` to ensure mode selector clearly shows "Whitelist" and "Blacklist" options with explanatory text (whitelist: "Only matching invoices are budget-linked", blacklist: "Matching invoices are excluded from budget")
- [x] T019 Run `pnpm typecheck` and `pnpm lint`

**Commit**: Whitelist filter support verified and UI labels clarified

**Checkpoint**: Both blacklist and whitelist vendor rules work. Combined rules respect blacklist precedence.

---

## Phase 5: User Story 3 — Admin filters by invoice number pattern (Priority: P2)

**Goal**: Admin can create filter rules using regex patterns against invoice numbers.

**Independent Test**: Create a blacklist invoice_number rule with pattern "^TEST-", ingest an invoice with number "TEST-001", verify it is filtered. Ingest "INV-2026-042", verify it passes.

### Implementation for User Story 3

- [x] T020 [US3] Update the create/edit filter form in `src/app/settings/ingestion/ingestion-filters-section.tsx` to show field-dependent value inputs: when field is "vendor" show a multi-value text input for vendor names; when field is "invoice_number" show a single text input for regex pattern with inline validation (try-catch `new RegExp()`) and a helper text explaining regex syntax
- [x] T021 [US3] Verify invoice_number regex matching in `src/lib/ingestion-filters.ts`: ensure `new RegExp(pattern, "i")` is used with try-catch, and that the pattern is tested against the invoice's `invoiceNumber` field
- [x] T022 Run `pnpm typecheck` and `pnpm lint`

**Commit**: Invoice number pattern filter rules with regex validation

**Checkpoint**: All three filter fields (vendor blacklist, vendor whitelist, invoice number pattern) work across all ingestion channels.

---

## Phase 6: User Story 4 — Admin manages existing filter rules (Priority: P2)

**Goal**: Admin can enable/disable, edit, and delete existing rules. Changes affect future ingestions only.

**Independent Test**: Create a rule, disable it, ingest a matching invoice, verify it passes through. Re-enable, ingest again, verify it is filtered.

### Implementation for User Story 4

- [x] T023 [P] [US4] Add `updateIngestionFilter(input)` and `toggleIngestionFilter(id)` server actions to `src/actions/ingestion-filters.ts`: partial update with Zod validation, toggle flips the `enabled` boolean, both `revalidatePath`
- [x] T024 [P] [US4] Add edit and toggle functionality to the filter table in `src/app/settings/ingestion/ingestion-filters-section.tsx`: enable/disable Switch per row calling `toggleIngestionFilter`, edit button opening the Sheet/Dialog pre-filled with current values, delete with confirmation
- [x] T025 Run `pnpm typecheck` and `pnpm lint`

**Commit**: Full filter rule management — edit, toggle, delete

**Checkpoint**: Complete CRUD lifecycle for filter rules.

---

## Phase 7: User Story 5 — Filtered invoices visible in ingestion history (Priority: P3)

**Goal**: Filtered invoices show a distinct "Filtered" badge in ingestion history and display the matched rule name.

**Independent Test**: Ingest an invoice matching a filter, view ingestion history, verify "Filtered" badge and rule name appear.

### Implementation for User Story 5

- [x] T026 [P] [US5] Update `OutcomeBadge` component usage in `src/app/settings/ingestion/ingestion-history-table.tsx`: add "filtered" → warning/amber variant mapping, add "filtered" to the outcome faceted filter options
- [x] T027 [P] [US5] Update the `IngestionLogRow` type in `src/actions/ingestion-log.ts` to include "filtered" in the outcome union type; verify the `getIngestionHistory()` query returns filtered entries (no query changes needed — already selects all outcomes)
- [x] T028 [US5] Verify that the `errorMessage` column in the ingestion history table shows the filter reason (matched rule name) for filtered entries — the existing `ErrorPopover` component should render this automatically since filter reason is stored in `errorMessage`
- [x] T029 Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`

**Commit**: Filtered outcome badge and audit trail in ingestion history

**Checkpoint**: Full auditability — admins can see which invoices were filtered and why.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, edge case handling, build validation.

- [x] T030 Verify edge case: no filter rules configured — ingest an invoice and confirm it passes through to budget linking exactly as before (FR-017)
- [x] T031 Verify edge case: all rules disabled — confirm same pass-through behavior
- [x] T032 Verify edge case: missing vendor field on invoice — confirm blacklist vendor rules do not match, whitelist vendor rules treat as "no match"
- [x] T033 Run full `pnpm build` and verify zero type errors and zero lint warnings
- [x] T034 Run quickstart.md manual verification checklist

**Commit**: Final verification and polish

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — core MVP
- **US2 (Phase 4)**: Depends on Phase 3 (whitelist builds on same evaluation engine + UI)
- **US3 (Phase 5)**: Depends on Phase 3 (adds invoice_number field to existing filter UI + engine)
- **US4 (Phase 6)**: Depends on Phase 3 (edit/toggle needs existing CRUD + UI)
- **US5 (Phase 7)**: Depends on Phase 2 only (history UI update is independent of filter CRUD)
- **Polish (Phase 8)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: Foundational → US1 (no other story deps)
- **US2 (P1)**: US1 → US2 (extends evaluation logic and UI from US1)
- **US3 (P2)**: US1 → US3 (adds field type to US1's filter form)
- **US4 (P2)**: US1 → US4 (adds management actions to US1's CRUD)
- **US5 (P3)**: Foundational → US5 (independent of filter CRUD — only needs "filtered" outcome enum)

### Within Each User Story

- Server actions before UI components (data layer first)
- Evaluation logic before integration into routes
- Integration into API route and saveInvoice can be parallel (different files)

### Parallel Opportunities

- T007, T008 can run in parallel (different files)
- T011, T012 can run in parallel (actions vs UI component)
- T013, T014 can run in parallel (API route vs server action — different files)
- T023, T024 can run in parallel (actions vs UI)
- T026, T027 can run in parallel (UI table vs action type)
- US5 (Phase 7) can run in parallel with US3 or US4 (independent of filter CRUD)

---

## Parallel Example: User Story 1

```bash
# Launch actions and UI in parallel:
Task: "T011 - Create CRUD server actions in src/actions/ingestion-filters.ts"
Task: "T012 - Create filter management UI in src/app/settings/ingestion/ingestion-filters-section.tsx"

# Then launch route integrations in parallel:
Task: "T013 - Integrate filter into API ingest route"
Task: "T014 - Integrate filter into saveInvoice action"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Schema + Migration
2. Complete Phase 2: Validators, Logger, Evaluation Engine
3. Complete Phase 3: Blacklist filter rules (CRUD + evaluation + all ingest paths)
4. **STOP and VALIDATE**: Create a blacklist vendor rule, ingest a matching invoice, verify it is stored but not budget-linked
5. Commit and deploy if ready

### Incremental Delivery

1. Setup + Foundational → Schema and core engine ready
2. US1 (blacklist) → Test independently → **Commit** (MVP!)
3. US2 (whitelist) → Test independently → **Commit**
4. US3 (invoice number pattern) → Test independently → **Commit**
5. US4 (rule management) → Test independently → **Commit**
6. US5 (history visibility) → Test independently → **Commit**
7. Polish → Final validation → **Commit**

Each story adds value without breaking previous stories.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each phase or logical group — keep the codebase buildable at all times
- The user requested "commit often" — each phase boundary is a natural commit point
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
