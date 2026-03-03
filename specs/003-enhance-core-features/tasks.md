# Tasks: Enhance Core Features

**Input**: Design documents from `/specs/003-enhance-core-features/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: No test tasks included — tests were not explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New utilities and environment configuration needed before schema or feature work

- [x] T001 Create `src/lib/crypto.ts` with `encryptApiKey()`, `decryptApiKey()`, and `maskApiKey()` functions using AES-256-GCM via Node.js built-in `crypto` module, key derived from `API_KEY_ENCRYPTION_SECRET` env var with scrypt
- [x] T002 [P] Add `API_KEY_ENCRYPTION_SECRET` entry to `.env.example` with generation command (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

---

## Phase 2: Foundational (Database, Validators, Types)

**Purpose**: Schema changes, migrations, validators, types, and shared components that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Update `src/lib/db/schema.ts` — rename `department` column to `circle` on users table, add nullable `workspace` varchar(200) and `apiKeyEncrypted` varchar(700) columns to `licenseAssignments`, define `assignmentComments` table (id, assignmentId FK cascade, authorId FK restrict, body varchar(2000), createdAt, updatedAt) with indexes, define `billedCosts` table (id, periodId FK cascade, amountCents integer, invoiceDate date, description varchar(500), vendorReference varchar(255) nullable, createdAt, updatedAt) with indexes, and update all relations
- [x] T004 Create manual migration SQL file in `src/lib/db/migrations/` for `ALTER TABLE "users" RENAME COLUMN "department" TO "circle"` and `ALTER INDEX "users_department_idx" RENAME TO "users_circle_idx"`
- [ ] T005 Run `pnpm db:generate` (requires interactive terminal) to generate Drizzle migration snapshot in `src/lib/db/migrations/` for new tables and columns after schema.ts changes
- [x] T006 [P] Update `src/lib/validators.ts` — rename `department` to `circle` in `userSchema` and `bulkImportUserSchema`, add `updateAssignmentSchema` (id, tierId?, assignedAt?, workspace?, apiKey?), `assignmentCommentSchema` (assignmentId, body 1-2000 chars), `billedCostSchema` (periodId, amountCents positive int, invoiceDate YYYY-MM-DD, description 1-500, vendorReference? max 255), `updateBilledCostSchema` (id, all fields optional), `deleteBilledCostSchema` (id) per data-model.md Zod specifications
- [x] T007 [P] Update `src/types/index.ts` — add optional `warning?: string` to `ActionResult<T>` success branch, add `AssignmentComment`, `NewAssignmentComment`, `BilledCost`, `NewBilledCost` types inferred from schema, add `PeriodWithCosts` (BudgetPeriod + expectedSpendCents + billedTotalCents + billedEntries) and `BudgetWithCosts` (AnnualBudget + periods: PeriodWithCosts[]) computed types
- [x] T008 [P] Create `src/components/auth-guard.tsx` as a server component accepting `requiredRole?: "admin"` prop — render "Authentication Required" card with Sign In link (including `callbackUrl` from `x-pathname` header) when unauthenticated, render "Access Denied" message when authenticated but role doesn't match, render children when authorized

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Unauthenticated User Login & Role-Based Sidebar (Priority: P1) MVP

**Goal**: Unauthenticated visitors see a sidebar with login option; after auth, sidebar adapts to role (admin: full nav, viewer: Dashboard + Assignments + Settings)

**Independent Test**: Open app in incognito to verify unauthenticated sidebar with login, then log in as viewer to verify limited sidebar, and as admin to verify full sidebar

### Implementation for User Story 1

- [x] T009 [US1] Update `src/middleware.ts` — replace auth-redirect middleware with a pass-through that sets `x-pathname` response header with the current pathname; remove matcher config so all routes are accessible to unauthenticated users (auth enforcement moves to AuthGuard)
- [x] T010 [US1] Update `src/components/app-sidebar.tsx` — accept nullable `userName`/`userRole` props; when unauthenticated show branding header + "Sign in to access the application" muted text + Sign In primary button in footer linking to `/login`; when viewer role show only Dashboard, Assignments, Settings nav items; when admin role show full nav (Dashboard, Tools, Users, Assignments, Budget, Reports, Settings); define nav items with `roles` array for filtering
- [x] T011 [US1] Update `src/app/layout.tsx` — always render `SidebarProvider` + `AppSidebar` regardless of auth state; pass nullable `userName` and `userRole` from session to sidebar; remove any auth-gating around the sidebar shell
- [x] T012 [US1] Extract login form to `src/app/(auth)/login/login-form.tsx` as a client component; update `src/app/(auth)/login/page.tsx` to read `searchParams.callbackUrl` and pass it to the form; after successful sign-in redirect to `callbackUrl` (default `/`) instead of hardcoded `/`
- [x] T013 [US1] Wrap all protected page server components with `AuthGuard` — update `src/app/page.tsx` (role: any auth), `src/app/tools/page.tsx` (admin), `src/app/tools/[id]/page.tsx` (admin), `src/app/tools/new/page.tsx` (admin), `src/app/users/page.tsx` (admin), `src/app/users/[id]/page.tsx` (admin), `src/app/users/new/page.tsx` (admin), `src/app/users/import/page.tsx` (admin), `src/app/assignments/page.tsx` (any auth), `src/app/budget/page.tsx` (admin), `src/app/budget/[id]/page.tsx` (admin), `src/app/budget/new/page.tsx` (admin), `src/app/reports/page.tsx` (admin)
- [x] T014 [US1] Implement viewer-personalized Dashboard in `src/app/page.tsx` — when `session.user.role === "viewer"`, query and display: own assigned tools count, own total license cost (sum of costAtAssignmentCents), and 5 most recent assignment change history entries for the user
- [x] T015 [US1] Add viewer-role filter to `src/app/assignments/page.tsx` — when role is "viewer", add `where: eq(licenseAssignments.userId, session.user.id)` to the assignments query so viewers see only their own assignments

**Checkpoint**: Unauthenticated sidebar, role-based navigation, and viewer personalization are fully functional

---

## Phase 4: User Story 2 — Rename Department to Circle (Priority: P1)

**Goal**: All UI references to "Department" replaced with "Circle" to align with Holacracy terminology; database column renamed; CSV import accepts both headers

**Independent Test**: Search the entire UI for any occurrence of "Department" and verify it reads "Circle" in all contexts (forms, tables, reports, CSV import headers)

### Implementation for User Story 2

- [x] T016 [P] [US2] Update `src/lib/db/seed.ts` — replace `department` field references with `circle` in all seed data objects
- [x] T017 [P] [US2] Update `src/actions/users.ts` — replace all `department` references with `circle` in queries, insert/update mutations, and any CSV parsing logic
- [x] T018 [P] [US2] Update `src/app/users/new/new-user-form.tsx` — rename "Department" label to "Circle", rename form field from `department` to `circle`, update placeholder text
- [x] T019 [P] [US2] Update `src/app/users/users-table.tsx` — rename "Department" column header to "Circle", update accessor key from `department` to `circle`
- [x] T020 [P] [US2] Update `src/app/users/[id]/user-detail-client.tsx` — rename "Department" to "Circle" in detail display labels and edit form fields
- [x] T021 [US2] Update `src/app/users/import/bulk-import-form.tsx` — accept both "department" and "circle" as valid CSV column headers mapping to the `circle` field, update help text to show "circle (or department)" as expected header
- [x] T022 [P] [US2] Update `src/app/reports/page.tsx` — rename "License distribution and cost by department" to "License distribution and cost by circle", rename "Department" column header to "Circle" in the organizational breakdown table

**Checkpoint**: All "Department" references are replaced with "Circle" across the entire application

---

## Phase 5: User Story 3 — Editable Tool Tiers with Change History (Priority: P2)

**Goal**: Administrators can edit existing tier name, description, monthly cost, and active status via a dialog; all changes recorded in change history

**Independent Test**: Edit a tier's monthly cost, then view the tool's change history to verify old/new values with timestamp and user

### Implementation for User Story 3

- [x] T023 [US3] Add tier edit dialog to `src/app/tools/[id]/tool-detail-client.tsx` — add edit button (Pencil icon) to each tier card; open a Dialog pre-populated with current values using `react-hook-form` + `updateTierSchema`; include name, description, monthly cost (dollars input converted to cents), and active status toggle; show warning message when attempting to deactivate a tier with active assignments; call existing `updateTier` server action on save

**Checkpoint**: Tier editing with full audit trail is functional

---

## Phase 6: User Story 4 — Editable License Assignments with Retrospective Dating (Priority: P2)

**Goal**: Administrators can edit active assignments (tier change, retrospective date, meta fields); all edits audited; retrospective dates validated

**Independent Test**: Create an assignment with a past date (e.g., two months ago) and verify it appears correctly in historical reports and budget calculations

### Implementation for User Story 4

- [x] T024 [US4] Implement `updateAssignment` server action in `src/actions/assignments.ts` — accept `updateAssignmentSchema` input; on tier change recalculate `costAtAssignmentCents` to new tier's `monthlyCostCents`; validate retrospective `assignedAt` is not future, not before user.createdAt or tool.createdAt; return `warning` in ActionResult if date > 12 months past; encrypt apiKey via `encryptApiKey()` before storage; record all changed fields in `changeHistory` (use `[redacted]` for API key values); revalidate `/assignments`
- [x] T025 [US4] Add assignment edit dialog to `src/app/assignments/assignments-client.tsx` — add edit button to each assignment row; open Dialog with `react-hook-form` + `updateAssignmentSchema`; include tier dropdown (active tiers for the tool), date picker via `Calendar` component with `captionLayout="dropdown"` and future dates disabled, workspace text input (max 200), API key input with masked display and reveal/copy buttons; show warning banner when retrospective date > 12 months; call `updateAssignment` on save

**Checkpoint**: Assignment editing with retrospective dating and meta field updates is functional

---

## Phase 7: User Story 5 — Assignment Meta Information Fields (Priority: P2)

**Goal**: Assignments include workspace, API key (masked with reveal), and timestamped comments; detail view shows all meta fields and comment history

**Independent Test**: Create an assignment with all meta fields populated, then verify data persists and displays correctly on the assignment detail view and in the assignments table

### Implementation for User Story 5

- [x] T026 [US5] Implement `revealApiKey` server action in `src/actions/assignments.ts` — admin-only via `requireAdmin()`, decrypt `apiKeyEncrypted` using `decryptApiKey()` from `src/lib/crypto.ts`, return `{ plaintext: string }`, return error if no API key stored; do NOT log plaintext in change history
- [x] T027 [US5] Implement `addAssignmentComment` and `getAssignmentComments` actions in `src/actions/assignments.ts` — `addAssignmentComment` validates via `assignmentCommentSchema`, sets `authorId` from session, inserts into `assignmentComments`, revalidates assignment detail; `getAssignmentComments` fetches all comments for an assignmentId ordered by `createdAt` ascending, joins author name
- [x] T028 [US5] Create assignment detail page at `src/app/assignments/[id]/page.tsx` with a client component — show assignment header (user → tool at tier), detail card (status, tier, cost, assignedAt, workspace, masked API key with reveal/copy via `revealApiKey` action), comments section with chronological list (author + timestamp + body), and add-comment form (textarea max 2000 chars + submit button calling `addAssignmentComment`)
- [x] T029 [P] [US5] Add workspace column to the assignments data table in `src/app/assignments/assignments-client.tsx` — display workspace value in a new column after the status column; API key and comments remain accessible only from the detail/edit views

**Checkpoint**: Assignment meta fields, API key security, and comment system are fully functional

---

## Phase 8: User Story 6 — Budget Billed Costs Tracking (Priority: P3)

**Goal**: Budget system tracks billed costs alongside expected costs (renamed from "actual"); administrators can add/edit/delete billed entries per period; variance = billed − expected

**Independent Test**: Navigate to a budget period, add two billed cost entries, verify billed total, expected total, and variance are all displayed correctly

### Implementation for User Story 6

- [x] T030 [US6] Rename "actual costs"/"actual spend" to "expected costs"/"expected spend" in `src/actions/budget.ts` — rename `getActualSpendForPeriod` function to `getExpectedSpendForPeriod`, update all internal references; update `src/app/budget/[id]/budget-detail-client.tsx` and `src/app/budget/page.tsx` UI labels from "Actual" to "Expected"
- [x] T031 [US6] Implement `createBilledCost`, `updateBilledCost`, and `deleteBilledCost` server actions in `src/actions/budget.ts` — each validates with respective Zod schema, checks `requireAdmin()`, guards against archived budgets via `requireActivePeriod(periodId)` helper that joins `budgetPeriods` → `annualBudgets` and rejects if `status === "archived"`; record all mutations in `changeHistory` with `entityType: "billed_cost"` (deletion records `previousValue` as JSON snapshot before deleting); revalidate budget detail paths
- [x] T032 [US6] Implement `getBudgetWithCosts` function in `src/actions/budget.ts` — load budget with all periods via relational query, calculate `expectedSpendCents` per period from active assignments (where `assignedAt <= period.endDate AND (revokedAt IS NULL OR revokedAt >= period.startDate)`), aggregate `billedTotalCents` per period from `billedCosts` table, return `BudgetWithCosts` type
- [x] T033 [US6] Add billed costs section to `src/app/budget/[id]/budget-detail-client.tsx` — show per-period summary row with planned, expected, billed totals; variance column with `+$X` prefix and `text-destructive` for over-billed, `-$X` and `text-muted-foreground` for under-billed; expandable billed cost entry list per period with add/edit/delete dialogs (amount in dollars, required invoice date picker, description, optional vendor reference); block add/edit/delete when budget is archived
- [x] T034 [US6] Update budget overview table in `src/app/budget/page.tsx` — add Expected, Billed, and Variance columns alongside the existing Planned column for each budget row; use `getBudgetWithCosts` or an equivalent aggregation to populate totals

**Checkpoint**: Budget billed costs tracking with expected/billed variance reporting is fully functional

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Terminology changes in shared pages, accessibility for viewer role, and build validation

- [ ] T035 [P] Update `src/app/reports/page.tsx` — rename any remaining "actual costs" labels to "expected costs" and add "billed costs" column where applicable per FR-021 and US6 acceptance scenario 5
- [ ] T036 [P] Update `src/app/settings/appearance/page.tsx` — ensure settings page renders correctly for viewer-role users (no admin-only content exposed)
- [ ] T037 Run `pnpm typecheck` and fix any TypeScript strict compilation errors across all modified `src/` files
- [ ] T038 Run `pnpm lint` and fix any ESLint warnings across all modified `src/` files
- [ ] T039 Run `pnpm build` and verify production build succeeds with zero errors in `src/` and `.next/` output

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
  - T003 (schema) must complete before T004 (migration) and T005 (db:generate)
  - T006, T007, T008 can run in parallel (different files) after T003
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 and US2 are both P1 and can proceed in parallel
  - US3, US4, US5 are all P2; US4 should complete before US5 (edit dialog before detail view)
  - US6 is P3 and depends only on Foundational phase
- **Polish (Phase 9)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — no dependencies on other stories
- **US2 (P1)**: Can start after Foundational — no dependencies on other stories (can run in parallel with US1)
- **US3 (P2)**: Can start after Foundational — no dependencies on other stories
- **US4 (P2)**: Can start after Foundational — no dependencies on other stories
- **US5 (P2)**: Depends on US4 completion (edit dialog created in US4 is extended in US5; `updateAssignment` action from US4 is a prerequisite for `revealApiKey` and comment actions)
- **US6 (P3)**: Can start after Foundational — no dependencies on other stories

### Within Each User Story

- Schema and validators (Foundational) before server actions
- Server actions before UI components
- Core UI before integration/refinement tasks

### Parallel Opportunities

- **Phase 1**: T001 and T002 can run in parallel (different files)
- **Phase 2**: T006, T007, T008 can all run in parallel (different files, no inter-dependencies)
- **Phase 3 (US1)**: T009, T010, T011 modify different files but T013 depends on T008 (Foundational)
- **Phase 4 (US2)**: T016, T017, T018, T019, T020, T022 can all run in parallel (each modifies a different file); T021 is sequential (depends on T017 for CSV parsing pattern)
- **Phase 7 (US5)**: T029 can run in parallel with T026-T028 (different section of the same file, but adds a column vs. adding actions)
- **Phase 9**: T035 and T036 can run in parallel (different files)
- **Cross-story**: US1 and US2 can run in parallel. US3, US4, and US6 can run in parallel. US5 follows US4.

---

## Parallel Example: User Story 2

```bash
# Launch all independent rename tasks together:
Task T016: "Update seed.ts — department → circle"
Task T017: "Update actions/users.ts — department → circle"
Task T018: "Update new-user-form.tsx — Department → Circle"
Task T019: "Update users-table.tsx — Department → Circle"
Task T020: "Update user-detail-client.tsx — Department → Circle"
Task T022: "Update reports/page.tsx — Department → Circle"

# Then sequentially:
Task T021: "Update bulk-import-form.tsx — accept both headers" (after T017)
```

## Parallel Example: Foundational Phase

```bash
# Sequential first (schema → migration):
Task T003: "Update schema.ts with all new tables/columns/renames"
Task T004: "Create manual migration SQL for department→circle"
Task T005: "Run pnpm db:generate for new tables"

# Then parallel (all independent files):
Task T006: "Update validators.ts with new Zod schemas"
Task T007: "Update types/index.ts with new types"
Task T008: "Create auth-guard.tsx component"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T008)
3. Complete Phase 3: User Story 1 (T009-T015)
4. **STOP and VALIDATE**: Test unauthenticated sidebar, role-based nav, viewer dashboard independently
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Auth & Sidebar) → Test independently → Deploy (MVP!)
3. Add US2 (Dept→Circle rename) → Test independently → Deploy
4. Add US3 (Tier editing) → Test independently → Deploy
5. Add US4 (Assignment editing) → Test independently → Deploy
6. Add US5 (Meta fields & comments) → Test independently → Deploy
7. Add US6 (Billed costs) → Test independently → Deploy
8. Polish phase → Final validation → Deploy

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (Auth & Sidebar) + US3 (Tier editing)
   - Developer B: US2 (Dept→Circle) + US4 (Assignment editing) → then US5 (Meta fields)
   - Developer C: US6 (Billed costs)
3. Stories complete and integrate independently
4. Team reconvenes for Polish phase

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Foundational phase
- No test tasks generated — tests were not requested in the feature specification
- Monetary values always stored as integers (cents) — dollar display is UI-only conversion
- API key encryption uses Node.js built-in `crypto` — no new dependencies
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
