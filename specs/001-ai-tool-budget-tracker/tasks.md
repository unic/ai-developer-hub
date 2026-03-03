# Tasks: AI Tool Access & Budget Tracker

**Input**: Design documents from `/specs/001-ai-tool-budget-tracker/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, quickstart.md, contracts/

**Tests**: Not included — no explicit test requirement in the feature specification. Add test phases per story if TDD is desired.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding, dependency installation, tooling configuration

- [x] T001 Scaffold Next.js 15 project with `pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-pnpm`
- [x] T002 Install all production dependencies: `@neondatabase/serverless drizzle-orm next-auth@5 @auth/drizzle-adapter zod react-hook-form @hookform/resolvers recharts @tanstack/react-table bcryptjs`
- [x] T003 Install all dev dependencies: `drizzle-kit @types/bcryptjs vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @playwright/test @axe-core/playwright @lhci/cli eslint-plugin-jsx-a11y prettier`
- [x] T004 Initialize shadcn/ui (`pnpm dlx shadcn@latest init`) and add all 24 required components: button, card, input, label, select, textarea, table, form, dialog, alert, alert-dialog, badge, tabs, sidebar, breadcrumb, dropdown-menu, command, skeleton, switch, calendar, chart, separator, toast, combobox
- [x] T005 [P] Create project directory structure: src/actions/, src/types/, src/lib/db/migrations/, tests/unit/, tests/integration/, tests/e2e/
- [x] T006 [P] Create .env.local.example with placeholder variables: DATABASE_URL, DATABASE_URL_UNPOOLED, AUTH_SECRET, NEXTAUTH_URL
- [x] T007 [P] Create drizzle.config.ts at project root with schema path `./src/lib/db/schema.ts`, output `./src/lib/db/migrations`, PostgreSQL dialect, and `DATABASE_URL_UNPOOLED` connection
- [x] T008 [P] Add all package.json scripts per quickstart.md: dev, build, start, lint, format, format:check, typecheck, db:push, db:generate, db:migrate, db:seed, test, test:watch, test:integration, test:e2e, test:a11y, lighthouse

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, authentication, layout, shared utilities — MUST complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 [P] Define complete Drizzle ORM schema for all 7 entities (users, ai_tools, access_tiers, license_assignments, annual_budgets, budget_periods, change_history) with pgEnum types, column constraints, indexes, and Drizzle relations in src/lib/db/schema.ts
- [x] T010 [P] Create database connection module using Neon serverless WebSocket Pool adapter (`@neondatabase/serverless` Pool + `drizzle-orm/neon-serverless`) with `max: 1` pool size in src/lib/db/index.ts
- [x] T011 [P] Create shared TypeScript types: ActionResult<T> union type, role/status enum types, entity select/insert types re-exported from Drizzle schema in src/types/index.ts
- [x] T012 [P] Create shared Zod validation schemas for all entities (loginSchema, toolSchema, tierSchema, userSchema, bulkImportUserSchema, assignmentSchema, budgetSchema, budgetAllocationSchema) with client+server reuse in src/lib/validators.ts
- [x] T013 [P] Create utility functions: cn() class merge helper (if not from shadcn init), formatCurrency(cents) → dollar string, formatDate(timestamp) → formatted string in src/lib/utils.ts
- [x] T014 Configure NextAuth.js v5 with Credentials provider (email/password + bcryptjs verify), Drizzle adapter, JWT session strategy injecting user id and role, and authorize callback querying users table in src/lib/auth.ts
- [x] T015 [P] Create NextAuth API route handler exporting GET and POST from auth config in src/app/api/auth/[...nextauth]/route.ts
- [x] T016 Create auth middleware matching all routes except /login and static assets, redirecting unauthenticated users to /login in src/middleware.ts
- [x] T017 Create login page with email/password form using React Hook Form + loginSchema Zod resolver, signIn() call, and error display in src/app/(auth)/login/page.tsx
- [x] T018 [P] Create minimal auth layout with centered card and no sidebar for login pages in src/app/(auth)/layout.tsx
- [x] T019 Create root layout with shadcn/ui Sidebar navigation (links: Dashboard, Tools, Users, Assignments, Budget, Reports), user session display, sign-out button, and role-based menu item visibility in src/app/layout.tsx
- [x] T020 [P] Create placeholder dashboard page with welcome message and navigation cards in src/app/page.tsx
- [x] T021 Implement change history recording helpers: recordCreation(), recordUpdate() (per-field diff), recordStatusChange(), and getEntityHistory() query in src/actions/history.ts
- [x] T022 Create database seed script that hashes a default admin password with bcryptjs and inserts initial admin user into users table in src/lib/db/seed.ts
- [x] T023 Push database schema to Neon with `pnpm db:push`, run seed with `pnpm db:seed`, and verify login works on `pnpm dev`

**Checkpoint**: Foundation ready — authentication works, layout renders, database connected. User story implementation can now begin.

---

## Phase 3: User Story 1 — Manage AI Tool Registry (Priority: P1) 🎯 MVP

**Goal**: Central catalog of all AI coding tools with vendor info, access tiers, pricing, and capacity limits

**Independent Test**: Add a new AI tool with tiers → edit tool pricing → view tool catalog list → verify all details display correctly

### Implementation for User Story 1

- [x] T024 [US1] Implement tool server actions (createTool, updateTool, archiveTool) with Zod validation, admin auth guard, FR-019 active-assignment deletion check, change history recording, and revalidatePath in src/actions/tools.ts
- [x] T025 [US1] Implement tier server actions (createTier, updateTier) with per-tool name uniqueness check, admin auth guard, change history recording, and revalidatePath in src/actions/tools.ts
- [x] T026 [P] [US1] Create tool list page as Server Component with DataTable: columns (name, vendor, tier count, active licenses, status), client-side sorting, filtering by vendor/status, global search, and Admin row actions dropdown in src/app/tools/page.tsx
- [x] T027 [P] [US1] Create add-new-tool form page with React Hook Form + toolSchema, inline tier definition via dynamic field array (name, description, monthly cost per tier), and createTool + createTier server action submission in src/app/tools/new/page.tsx
- [x] T028 [US1] Create tool detail/edit page with tool edit form, tier management table (add/edit tiers inline), active assignment count per tier, archive button with FR-019 guard, and change history timeline in src/app/tools/[id]/page.tsx

**Checkpoint**: Tool registry fully functional — admins can add, edit, view, and archive AI tools with tiers and pricing.

---

## Phase 4: User Story 3 — Company User Management (Priority: P1)

**Goal**: Searchable directory of company employees eligible for AI tool access with CRUD and deactivation

**Independent Test**: Add a new user → edit department → search/filter user list → deactivate user → verify license revocation cascade

### Implementation for User Story 3

- [x] T029 [US3] Implement user server actions: createUser (email uniqueness), updateUser, deactivateUser (cascading license revocation via transaction per FR-007), bulkImportUsers (per-row validation, partial-success per FR-018) with admin auth guard and change history in src/actions/users.ts
- [x] T030 [P] [US3] Create user directory page with DataTable: columns (name, email, department, role, status, assigned tool count), filter by department/status, global search, and Admin row actions in src/app/users/page.tsx
- [x] T031 [P] [US3] Create add-new-user form page with React Hook Form + userSchema, all required fields (name, email, department, role), optional GitHub username, and createUser submission in src/app/users/new/page.tsx
- [x] T032 [US3] Create user detail/edit page with edit form, assigned tools list (read-only for now), deactivation with AlertDialog confirmation, and change history timeline in src/app/users/[id]/page.tsx
- [x] T033 [US3] Create bulk import page with CSV file upload input, client-side CSV parsing, validation preview table with error highlighting, import confirmation, and bulkImportUsers action call with result summary in src/app/users/import/page.tsx

**Checkpoint**: User management fully functional — admins can manage the employee directory, deactivation cascades to licenses.

---

## Phase 5: User Story 2 — Assign and Track User Licenses (Priority: P1)

**Goal**: License assignment management linking users to tools at specific tiers with capacity enforcement

**Independent Test**: Assign a license (user + tool + tier) → verify capacity check → upgrade tier → revoke license → verify counts update

**Dependencies**: Requires US1 (tools/tiers must exist) and US3 (users must exist)

### Implementation for User Story 2

- [x] T034 [US2] Implement assignment server actions: assignLicense (capacity check per FR-006, upgrade/downgrade via deactivate-old+create-new in transaction, cost_at_assignment_cents snapshot per FR-020), revokeLicense (set inactive + revoked_at) with admin auth guard and change history in src/actions/assignments.ts
- [x] T035 [US2] Create license assignments page with DataTable: columns (user name, tool name, tier, monthly cost, status, assigned date, revoked date), filters by user/tool/tier/status, Admin assign-license dialog (select user → select tool → select tier with cost display), and revoke action button in src/app/assignments/page.tsx
- [x] T036 [P] [US2] Enhance user detail page to display assigned tools list with tier name, monthly cost, assignment date, and revoke button (Admin only) in src/app/users/[id]/page.tsx
- [x] T037 [P] [US2] Enhance tool detail page to display active license count, license capacity utilization bar, and assigned users list with tier info in src/app/tools/[id]/page.tsx

**Checkpoint**: License tracking fully functional — admins can assign, upgrade/downgrade, and revoke licenses with capacity enforcement.

---

## Phase 6: User Story 6 — Access Tier Management (Priority: P2)

**Goal**: Configurable pricing tiers per tool with historical cost preservation and deactivation controls

**Independent Test**: Edit a tier's cost → verify existing assignments retain original cost → deactivate a tier → verify it's unavailable for new assignments

**Dependencies**: Extends US1 (tool/tier UI already exists)

### Implementation for User Story 6

- [x] T038 [US6] Add tier deactivation logic to updateTier action: validate no active assignments before deactivation, update is_active flag, record change history in src/actions/tools.ts
- [x] T039 [US6] Enhance tier management UI in tool detail page: add per-tier active assignment count badge, deactivation toggle with validation feedback, cost-edit notice explaining prospective-only pricing (FR-020) in src/app/tools/[id]/page.tsx

**Checkpoint**: Tier management complete — cost changes are prospective-only, deactivation is validated.

---

## Phase 7: User Story 4 — Annual AI Budget Planning (Priority: P2)

**Goal**: Structured annual spending plan with fiscal year designation, period allocations, and overage validation

**Independent Test**: Create annual budget → allocate to monthly periods → verify total validation → view budget summary with unallocated remainder

### Implementation for User Story 4

- [x] T040 [US4] Implement budget server actions: createBudget (auto-generate 12 monthly or 4 quarterly periods with zero allocations in transaction, archive previous year per FR-021), updateBudgetAllocations (validate sum ≤ total per FR-010), updateBudgetTotal (validate ≥ existing allocations sum) with admin auth guard and change history in src/actions/budget.ts
- [x] T041 [P] [US4] Create budget overview page showing active budget card (fiscal year, total, period type, status), period allocations summary table, and unallocated remainder in src/app/budget/page.tsx
- [x] T042 [P] [US4] Create new budget form page with fiscal year input, total amount (dollars input → cents storage), period type radio (monthly/quarterly), and createBudget submission in src/app/budget/new/page.tsx
- [x] T043 [US4] Create budget detail page with inline-editable period allocation table (amount per period), running total vs. budget validation, overage warning display, and save-allocations action in src/app/budget/[id]/page.tsx

**Checkpoint**: Budget planning fully functional — admins can create annual budgets, allocate to periods, validate totals.

---

## Phase 8: User Story 5 — Budget vs. Actual Spending Tracking (Priority: P2)

**Goal**: Real-time budget health visibility with variance tracking, overrun alerts, and spending forecasts

**Independent Test**: View budget with actual spend derived from active licenses → verify variance calculation → confirm >10% overrun highlighting → check YTD forecast

**Dependencies**: Requires US4 (budget/periods must exist) and US2 (license assignments drive actual spend)

### Implementation for User Story 5

- [x] T044 [US5] Implement actual spend calculation: query active license_assignments per budget period using cost_at_assignment_cents and date ranges, aggregate per-tool cost breakdown, compute variance and overrun flag (>10% threshold per FR-013) in src/actions/budget.ts
- [x] T045 [US5] Enhance budget detail page with variance columns (planned, actual, variance, % diff) per period, color-coded overrun highlighting, YTD summary row (planned, actual, variance), and projected annual forecast based on current run-rate in src/app/budget/[id]/page.tsx
- [x] T046 [US5] Add per-tool spending breakdown table and pie/donut chart (Recharts PieChart) showing cost attribution per tool to budget detail page in src/app/budget/[id]/page.tsx
- [x] T047 [P] [US5] Add planned vs. actual grouped bar chart (Recharts BarChart) showing period-by-period comparison to budget overview page in src/app/budget/page.tsx

**Checkpoint**: Budget tracking complete — variance, overruns, forecasts, and per-tool breakdown all visible.

---

## Phase 9: User Story 7 — Reporting and Dashboards (Priority: P3)

**Goal**: Visual insights into tool adoption, license utilization, and spending trends for all authenticated users

**Independent Test**: View dashboard with summary widgets → verify charts render with data → generate department-filtered report → export/view results

**Dependencies**: Requires US1, US2, US3, US4, US5 for complete data

### Implementation for User Story 7

- [x] T048 [US7] Build full dashboard home page replacing placeholder: summary widgets (total active users, total tools, total active licenses, current month spend formatted as currency, YTD budget utilization %), budget overrun alert indicator (FR-013), monthly spending trend line chart (Recharts LineChart), and planned vs. actual bar chart (Recharts BarChart) in src/app/page.tsx
- [x] T049 [US7] Create reports page with department-filter dropdown, filtered license assignment report table (user, tool, tier, cost per department), license utilization by tool horizontal bar chart (Recharts BarChart), tool adoption summary cards, and per-tool cost breakdown visualization in src/app/reports/page.tsx

**Checkpoint**: All dashboards and reports functional — viewers and admins can analyze tool usage and spending.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Quality, consistency, and UX improvements across all user stories

- [x] T050 [P] Implement Viewer role UI restrictions: conditionally hide create/edit/delete/assign/revoke buttons and form pages for Viewer role using session.user.role checks across all pages
- [x] T051 [P] Add loading states with shadcn/ui Skeleton components to all Server Component data-fetching pages (tools, users, assignments, budget, reports, dashboard) via loading.tsx files
- [x] T052 [P] Add toast notifications (Sonner via shadcn/ui Toast) for all server action success/error responses across all form submissions
- [x] T053 Add responsive layout adjustments: collapsible sidebar on mobile, responsive DataTable column visibility, and touch-friendly action buttons in src/app/layout.tsx
- [x] T054 Run quickstart.md end-to-end validation: verify all setup steps execute, seed script works, login succeeds, and core CRUD flows complete successfully

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **US1 — Tool Registry (Phase 3)**: Depends on Foundational
- **US3 — User Management (Phase 4)**: Depends on Foundational — **can parallel with US1**
- **US2 — License Assignments (Phase 5)**: Depends on US1 + US3
- **US6 — Tier Management (Phase 6)**: Depends on US1
- **US4 — Budget Planning (Phase 7)**: Depends on Foundational — **can parallel with US1/US3**
- **US5 — Budget Tracking (Phase 8)**: Depends on US4 + US2
- **US7 — Reporting (Phase 9)**: Depends on US1, US2, US3, US4, US5
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### Dependency Graph

```
                    ┌── US1 (Tools) ──────┬── US2 (Assignments) ──┬── US5 (Budget Tracking) ──┐
Setup → Foundation ─┤                     │                       │                           ├── US7 (Reporting) → Polish
                    ├── US3 (Users) ──────┘                       │                           │
                    │                                             │                           │
                    ├── US4 (Budget) ──────────────────────────────┘                           │
                    │                                                                         │
                    └── US6 (Tiers) ── (extends US1) ─────────────────────────────────────────┘
```

### Within Each User Story

- Server actions before pages (pages depend on actions)
- List pages can parallel with form pages (different files)
- Detail pages last (most complex, integrate multiple actions)
- Enhancement tasks (adding to existing pages) after the page is created

### Parallel Opportunities

**Phase 1**: T005, T006, T007, T008 can all run in parallel after T004
**Phase 2**: T009–T013 can all run in parallel; T015, T018, T020 can parallel after T014
**Phase 3**: T026 + T027 can run in parallel after T024/T025
**Phase 4**: T030 + T031 can run in parallel after T029
**Phase 5**: T036 + T037 can run in parallel
**Phase 7**: T041 + T042 can run in parallel after T040
**Phase 8**: T047 can parallel with T045/T046
**Phase 10**: T050, T051, T052 can all run in parallel

---

## Parallel Example: User Story 1

```bash
# After T024/T025 (server actions) are complete, launch page tasks in parallel:
Task T026: "Create tool list page with DataTable in src/app/tools/page.tsx"
Task T027: "Create add-new-tool form page with tier definition in src/app/tools/new/page.tsx"

# Then complete the detail page (depends on understanding both list and form patterns):
Task T028: "Create tool detail/edit page in src/app/tools/[id]/page.tsx"
```

## Parallel Example: Cross-Story

```bash
# After Foundational phase completes, launch independent stories in parallel:
Story US1: "Manage AI Tool Registry — start with T024"
Story US3: "Company User Management — start with T029"
Story US4: "Annual AI Budget Planning — start with T040"

# These three stories touch different files and have no cross-dependencies.
```

---

## Implementation Strategy

### MVP First (Setup + Foundation + User Story 1)

1. Complete Phase 1: Setup (T001–T008)
2. Complete Phase 2: Foundational (T009–T023)
3. Complete Phase 3: User Story 1 — Tool Registry (T024–T028)
4. **STOP and VALIDATE**: Verify tool CRUD works end-to-end with tiers
5. Deploy preview — tool catalog is immediately useful

### Incremental Delivery

1. **Setup + Foundational** → Auth works, layout renders, DB connected
2. **+ US1 (Tools)** → Tool catalog with tiers — **MVP!**
3. **+ US3 (Users)** → Employee directory with CRUD
4. **+ US2 (Assignments)** → License tracking links users to tools
5. **+ US6 (Tiers)** → Enhanced tier management with cost history
6. **+ US4 (Budget)** → Annual budget planning with allocations
7. **+ US5 (Budget Tracking)** → Variance, forecasts, overrun alerts
8. **+ US7 (Reporting)** → Dashboards and filtered reports
9. **+ Polish** → Role restrictions, loading states, toasts, responsive

Each increment adds value without breaking previous stories.

---

## Notes

- **[P]** tasks = different files, no dependencies on incomplete tasks in the same phase
- **[Story]** label maps each task to its user story for traceability
- Each user story is independently completable and testable at its checkpoint
- Monetary values always stored/computed in cents (integers) — display conversion in UI only
- Server Actions always return `ActionResult<T>` pattern per contracts/server-actions.md
- All mutations require admin role check via `auth()` session
- Change history recorded for every create/update/delete/status-change operation
- Commit after each task or logical group of tasks
- Tests can be added per story by inserting test tasks before implementation tasks
