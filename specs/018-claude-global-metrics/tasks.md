# Tasks: Global Claude Console Metrics & Budget Monitoring

**Feature**: 018-claude-global-metrics | **Branch**: 018-claude-global-metrics
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Format: `[ID] [P?] [Story?] Description`
- **[P]**: Parallelizable (different files, no incomplete dependencies)
- **[Story]**: User story label [US1]–[US4] (story phases only)

---

## Phase 1 — Setup

*Goal*: Schema changes and shared infrastructure that all user stories depend on.

- [ ] T001 Add `anthropic_workspaces` table to `src/lib/db/schema.ts` — columns: `id` serial PK, `workspaceId` varchar nullable, `name` varchar not null, `displayColor` varchar, `isDefault` boolean not null default false, `isArchived` boolean not null default false, `archivedAt` timestamp nullable, `anthropicCreatedAt` timestamp nullable, `lastSeenAt` timestamp not null, `createdAt` timestamp not null defaultNow(), `updatedAt` timestamp not null defaultNow(). Add two partial unique indexes: one on `workspaceId` WHERE workspaceId IS NOT NULL, one as a unique partial constraint WHERE workspaceId IS NULL (single-row guard via expression index).
- [ ] T002 [P] Add `anthropic_workspace_costs` table to `src/lib/db/schema.ts` — columns: `id` serial PK, `workspaceId` varchar nullable, `date` date not null, `costCents` integer not null, `createdAt` timestamp not null defaultNow(), `updatedAt` timestamp not null defaultNow(). Add two partial unique indexes on `(workspaceId, date)`: one WHERE workspaceId IS NOT NULL, one WHERE workspaceId IS NULL. Include a check constraint ensuring `costCents >= 0`.
- [ ] T003 [P] Add `anthropic_workspace_limits` table to `src/lib/db/schema.ts` — columns: `id` serial PK, `workspaceId` varchar nullable unique, `limitCents` integer not null, `createdAt` timestamp not null defaultNow(), `updatedAt` timestamp not null defaultNow(). Add partial unique index on `workspaceId` WHERE workspaceId IS NULL (at most one default-workspace limit). Add check constraint `limitCents > 0`.
- [ ] T004 [P] Add `anthropic_org_config` singleton table to `src/lib/db/schema.ts` — columns: `id` integer PK default 1, `billingBudgetLimitCents` integer nullable, `updatedAt` timestamp not null defaultNow(), `updatedBy` integer nullable FK→`users.id`. Add check constraint `id = 1` to enforce singleton. Do not use serial; the app always upserts with id=1.
- [ ] T005 Add `workspaceSyncCompletedAt` nullable timestamp column to the `anthropicSyncStatus` table definition in `src/lib/db/schema.ts`. This column records when the most recent workspace sync completed; the userId=-1 sentinel row uses it as a concurrency lock timestamp.
- [ ] T006 Run `pnpm db:push` to apply all schema changes to the development database. Verify the five schema objects (4 new tables + 1 new column) are created without error. This is a manual CLI step; document it as a prerequisite in a code comment at the top of `src/lib/db/schema.ts` near the new table definitions.
- [ ] T007 Export inferred Drizzle types for all four new tables from `src/lib/db/schema.ts`: `AnthropicWorkspace`, `NewAnthropicWorkspace`, `AnthropicWorkspaceCost`, `NewAnthropicWorkspaceCost`, `AnthropicWorkspaceLimit`, `NewAnthropicWorkspaceLimit`, `AnthropicOrgConfig`, `NewAnthropicOrgConfig`. Use `typeof tableName.$inferSelect` / `$inferInsert` pattern consistent with existing type exports in the file.

---

## Phase 2 — Foundational: Workspace Sync Infrastructure

*Goal*: Workspace sync logic and cron integration. Required before any dashboard data exists.

- [ ] T008 Create `src/lib/anthropic-workspace-sync.ts`. Implement `fetchAndUpsertWorkspaces()`: call Anthropic Admin API `GET /v1/organizations/workspaces?limit=100` (paginate if `has_more=true`) using `ANTHROPIC_ADMIN_API_KEY`. For each workspace, upsert into `anthropic_workspaces` using `onConflictDoUpdate` targeting the partial unique index. After upserting all returned workspaces, ensure a "default workspace" row exists (workspaceId=null, name="Default", isDefault=true) via upsert with the NULL-targeting partial index.
- [ ] T009 Add `fetchAndUpsertWorkspaceCosts(month?: string)` to `src/lib/anthropic-workspace-sync.ts`. Call Anthropic Admin API `GET /v1/organizations/cost_report?start_date=YYYY-MM-01&end_date=YYYY-MM-last` (use `date-fns` to compute the range; default to current month). Iterate the response `data[]` array: group by `workspace_id` (null = default workspace) and `date`. Convert USD float to cents via `Math.round(usd * 100)`. Upsert each `(workspaceId, date)` pair into `anthropic_workspace_costs` targeting the correct partial unique index (IS NOT DISTINCT FROM semantics). Set `updatedAt = now()` on conflict.
- [ ] T010 Add `syncAnthropicWorkspaces(month?: string)` orchestrator to `src/lib/anthropic-workspace-sync.ts`. Implement a concurrency guard using the userId=-1 sentinel row in `anthropicSyncStatus`: read `workspaceSyncCompletedAt`; if a sync completed within the last 50 minutes, return early with `{ skipped: true }`. Otherwise call `fetchAndUpsertWorkspaces()` then `fetchAndUpsertWorkspaceCosts(month)`, update the sentinel row's `workspaceSyncCompletedAt = now()`, then call `revalidateTag("anthropic-workspace-costs")` and `revalidateTag("alerts")` and `revalidatePath("/claude")`. Return `{ success: true, workspacesUpserted: number, costRowsUpserted: number }`.
- [ ] T011 Create `src/app/api/anthropic/workspace-sync/route.ts`. Export a `GET` handler. Validate `Authorization: Bearer ${CRON_SECRET}` header (same pattern as `src/app/api/anthropic/sync/route.ts`). Call `syncAnthropicWorkspaces()` from `src/lib/anthropic-workspace-sync.ts`. Return JSON `{ ok: true, result }` on success or `{ ok: false, error: string }` with status 500 on failure. Export `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- [ ] T012 Extend `src/app/api/anthropic/sync/route.ts`: after the existing per-user sync logic completes, check the userId=-1 sentinel row's `workspaceSyncCompletedAt`. If null or older than 50 minutes, call `syncAnthropicWorkspaces()` from `src/lib/anthropic-workspace-sync.ts` (fire-and-forget using `void` — do not await to avoid blocking the user sync response). Add a try/catch so workspace sync errors do not fail the user sync.
- [ ] T013 Add the workspace-sync cron entry to `vercel.json`. Add `{ "path": "/api/anthropic/workspace-sync", "schedule": "0 * * * *" }` to the `crons` array (runs every hour). Ensure the JSON remains valid and consistent with existing cron entries.

---

## Phase 3 — US1: Org-Wide Cost Dashboard

*Story goal*: Admin can view org-wide Claude costs for the current month with a daily chart, filterable by workspace and API key.

*Independent test*: Navigate to /claude as admin → see total org cost + daily breakdown chart. Verify non-admin is redirected.

- [ ] T014 [US1] Create `src/actions/anthropic-global.ts`. Add `getGlobalCostDashboard(month?: string)` server action (admin-only, use `auth()` from `src/lib/auth.ts` and check `session.user.role === "admin"`, throw/redirect on fail). Query `anthropic_workspace_costs` for the given month (default current month). Aggregate daily totals across all workspaces into `dailyTotals: { date: string; costCents: number }[]`. Build `workspaceBreakdown: { workspaceId: string | null; name: string; totalCents: number }[]` by joining with `anthropic_workspaces`. Compute `grandTotalCents`. Wrap with `unstable_cache` tagged `"anthropic-workspace-costs"`. Return typed `GlobalCostDashboardData`.
- [ ] T015 [US1] Add `getAvailableWorkspaceCostMonths()` server action to `src/actions/anthropic-global.ts`. Query `SELECT DISTINCT date_trunc('month', date) FROM anthropic_workspace_costs ORDER BY 1 DESC`. Return `string[]` of `"YYYY-MM"` formatted months. Admin-only. Wrap with `unstable_cache` tagged `"anthropic-workspace-costs"`.
- [ ] T016 [US1] Create `src/app/claude/page.tsx` as a Server Component. Add admin auth guard: call `auth()`, redirect to `/` if not admin. Call `getGlobalCostDashboard()` and `getAvailableWorkspaceCostMonths()`. Pass results as props to `<GlobalMetricsClient>`. Add a `<Suspense>` boundary with a skeleton fallback. Set `export const metadata = { title: "Claude Console" }`.
- [ ] T017 [US1] Create `src/components/claude/global-metrics-client.tsx` as a `"use client"` component. Accept `initialData: GlobalCostDashboardData`, `availableMonths: string[]`, and `initialMonth: string` as props. Render a summary card with `grandTotalCents` formatted as USD. Render a workspace/API key filter `<Select>` (options: "All workspaces" + one per workspace from `workspaceBreakdown`). Filter `dailyTotals` client-side when a workspace is selected (if workspace filter is active, replace dailyTotals with per-workspace daily data already embedded in initialData). Render the daily cost bar chart using `<ChartContainer>` + Recharts `<BarChart>` following the same pattern as `src/components/cost-chart.tsx`. When month changes (from MonthPicker), call `getGlobalCostDashboard(month)` via a server action import and update state.
- [ ] T018 [US1] Add a "Claude" nav item to `src/components/app-sidebar.tsx`. Use the `Bot` icon from `lucide-react`. Route: `/claude`. Make the item admin-only: conditionally render it based on `session.user.role === "admin"` (follow the same pattern used for other admin-only nav items in the file). Place it in the same nav group as other tool/reporting links.
- [ ] T019 [US1] Wire the `MonthPicker` component (from `src/components/profile/month-picker.tsx`) into `src/components/claude/global-metrics-client.tsx`. Render it above the chart. On month change, call `getGlobalCostDashboard(newMonth)` and update `dashboardData` state. Keep the workspace filter selection unchanged when the month changes (do not reset it). Show a loading spinner or disabled state on the chart while the new month data is loading (use React `useTransition`).

---

## Phase 4 — US2: Workspace Budget Limits & In-App Alerts

*Story goal*: Admin sets monthly spending limits per workspace; sees consumption progress bars; in-app notification badge appears from any page when ≥80% threshold is breached.

*Independent test*: Set a limit on a workspace → verify progress bar. Set limit at 80%+ of current spend → verify AlertBanner appears in layout.

- [ ] T020 [US2] Add `getWorkspaceList()` server action to `src/actions/anthropic-global.ts`. Perform a three-way left join: `anthropic_workspaces` LEFT JOIN `anthropic_workspace_costs` (aggregated to current-month total per workspace) LEFT JOIN `anthropic_workspace_limits`. Return `WorkspaceListItem[]` with fields: `workspaceId`, `name`, `isDefault`, `isArchived`, `currentMonthCents`, `limitCents` (nullable), `utilizationPct` (nullable, computed: currentMonthCents / limitCents * 100). Admin-only. Use `unstable_cache` tagged `"anthropic-workspace-costs"`.
- [ ] T021 [US2] Add `setWorkspaceLimit(workspaceId: string | null, limitCents: number | null)` server action to `src/actions/anthropic-global.ts`. Validate with Zod: `limitCents` must be a positive integer if provided, or null to delete. If `limitCents` is null, delete the row from `anthropic_workspace_limits` where `workspaceId IS NOT DISTINCT FROM` the provided value. Otherwise upsert using `onConflictDoUpdate`. After mutation, call `revalidateTag("anthropic-workspace-costs")` and `revalidateTag("alerts")` and `revalidatePath("/claude")`. Return `{ success: true } | { success: false, error: string }`. Admin-only.
- [ ] T022 [US2] Create `src/components/claude/workspace-budget-list.tsx` as a `"use client"` component. Accept `workspaces: WorkspaceListItem[]` as prop. Render each workspace as a card or table row with: workspace name badge, current month cost (formatted USD), optional limit (formatted USD or "No limit"), a shadcn `<Progress>` bar (hidden when no limit set), and utilization percentage. Color the progress bar and percentage: neutral when <80%, yellow (`text-yellow-600`) at ≥80%, red (`text-red-600`) at ≥100% (use `cn()` utility). Each row includes an inline edit button that opens an inline form (not a dialog) to set/clear the limit — on submit calls `setWorkspaceLimit()` server action and shows a Sonner toast on success/error.
- [ ] T023 [US2] Add workspace budget section to `src/app/claude/page.tsx`: call `getWorkspaceList()` alongside existing data fetches. Pass result to `<WorkspaceBudgetList>` component rendered below the global metrics chart. Add a section heading "Workspace Budgets" using a `<h2>` with appropriate Tailwind typography classes.
- [ ] T024 [US2] Create `src/actions/alerts.ts`. Implement `getActiveAlerts()` using `unstable_cache` with tag `"alerts"` and 5-minute revalidation TTL. Inside, call `getWorkspaceList()` logic directly (or import the underlying DB query to avoid auth re-check overhead). Compute workspace alerts: for each workspace with a limit where `utilizationPct >= 80`, push a `WorkspaceAlert` with fields `{ workspaceId, name, utilizationPct, severity: "warning" | "critical" }` (warning=80–99%, critical=≥100%). Return `{ workspaceAlerts: WorkspaceAlert[], creditsLow: false, creditsCritical: false }` typed as `ActiveAlertsData`. This function is called server-side from the layout and must NOT require an active session itself (session check is done by the layout before calling it).
- [ ] T025 [US2] Create `src/components/alert-banner.tsx` as a `"use client"` component. Accept `alerts: ActiveAlertsData` as prop. Render nothing if no active alerts. Render a shadcn `<Alert>` with `role="region"` and `aria-label="Budget alerts"` listing all workspace alerts with their severity (warning/critical). Add a visually-hidden `<div aria-live="polite" className="sr-only">` that announces the alert count once on mount via `useEffect`. Implement localStorage-based dismissal: compute a fingerprint from alert `workspaceId+utilizationPct` values; if the fingerprint matches the stored dismissed value, render nothing. Show a dismiss button that stores the current fingerprint in localStorage key `alert-banner-dismissed`. Re-announce if the fingerprint changes (new alerts not yet dismissed).
- [ ] T026 [US2] Modify `src/app/layout.tsx` to fetch alerts for admin users. Import `getActiveAlerts` from `src/actions/alerts.ts` and `<AlertBanner>` from `src/components/alert-banner.tsx`. After `auth()`, if `session?.user?.role === "admin"`, call `getActiveAlerts()`. Pass the result (or null/empty for non-admins) to `<AlertBanner alerts={alerts} />` rendered at the top of the `<body>` content, above the main layout shell. Use a null-safe default so non-admin and unauthenticated renders are unaffected.

---

## Phase 5 — US3: Org Billing Budget & Credits Panel

*Story goal*: Admin manually enters org billing budget limit; sees progress indicator against current org spend; credit balance panel shows "unavailable" informatively.

*Independent test*: Enter org billing budget limit → verify progress indicator appears. Verify credit panel renders "unavailable" state.

- [ ] T027 [US3] Add `getOrgConfig()` server action to `src/actions/anthropic-global.ts`. Query `anthropic_org_config` for the singleton row (id=1). Return `{ billingBudgetLimitCents: number | null }` or null if no row exists. Admin-only. Wrap with `unstable_cache` tagged `"alerts"` (so it refreshes alongside alert cache).
- [ ] T028 [US3] Add `setOrgBillingBudget(limitCents: number | null)` server action to `src/actions/anthropic-global.ts`. Validate with Zod: positive integer or null. Upsert the singleton row (id=1) into `anthropic_org_config` using `onConflictDoUpdate` on the `id` column; set `billingBudgetLimitCents`, `updatedAt = now()`, `updatedBy = session.user.id`. If `limitCents` is null, set `billingBudgetLimitCents = null`. After mutation, call `revalidateTag("alerts")` and `revalidatePath("/claude")`. Return `{ success: true } | { success: false, error: string }`. Admin-only.
- [ ] T029 [US3] Add `getOrgCreditsStatus()` server action to `src/actions/anthropic-global.ts`. Always returns `{ available: false, reason: "not_exposed_by_api" as const }`. Admin-only. No caching needed (pure constant). This stub is provided for future compatibility when Anthropic exposes credit balance via API.
- [ ] T030 [US3] Create `src/components/claude/org-credits-panel.tsx` as a `"use client"` component. Accept props: `orgConfig: { billingBudgetLimitCents: number | null } | null`, `currentMonthTotalCents: number`, `creditsStatus: { available: false, reason: string }`. Render two side-by-side cards: (1) "Org Billing Budget" card — if `billingBudgetLimitCents` is set, show a `<Progress>` bar with utilization % and color thresholds matching Phase 4 (≥80% warning, ≥100% critical); if null, show "No budget limit set". Include an inline edit form to call `setOrgBillingBudget()` with a Sonner toast on result. (2) "Credit Balance" card — always shows an informational `<Alert>` with icon `Info` stating "Credit balance is not available via the Anthropic API" with a link to the Anthropic Console. Use shadcn `<Card>` components for both panels.
- [ ] T031 [US3] Add org config and credits section to `src/app/claude/page.tsx`. Call `getOrgConfig()` and `getOrgCreditsStatus()` in the Server Component alongside existing data fetches. Pass results to `<OrgCreditsPanel>` rendered above the workspace budgets section. Add section heading "Organization Billing".

---

## Phase 6 — US4: Historical Global Cost Reporting

*Story goal*: Admin selects past months via month picker; all data and filters update accordingly.

*Independent test*: Select previous month → verify cost totals and workspace breakdown update. Verify workspace filter persists across month change.

- [ ] T032 [US4] Add `getAvailableMonths()` server action to `src/actions/anthropic-global.ts` (distinct from T015 rename — confirm the function is exported and accessible). If T015's `getAvailableWorkspaceCostMonths()` was used internally, ensure it is also exported publicly as `getAvailableMonths` for use by the client component. Returns `string[]` of `"YYYY-MM"` values descending, cached with tag `"anthropic-workspace-costs"`.
- [ ] T033 [US4] Ensure workspace filter state persists across month changes in `src/components/claude/global-metrics-client.tsx`. The `selectedWorkspaceId` state must NOT be reset when `selectedMonth` changes. When `getGlobalCostDashboard(newMonth)` resolves with new data, re-apply the existing workspace filter client-side to `workspaceBreakdown` so the user sees the filtered view for the new month. If the previously-selected workspace has zero cost in the new month, still show the workspace option (with $0.00) so the user can see the month had no cost for that workspace.
- [ ] T034 [US4] Verify that zero-cost workspaces render cleanly in `src/components/claude/workspace-budget-list.tsx`. When `currentMonthCents === 0` and a limit is set, the progress bar should show 0% (not NaN or undefined). When `currentMonthCents === 0` and no limit is set, render a muted "—" or "$0.00" for the cost. Add a guard in the utilization percentage computation: `limitCents > 0 ? Math.round((currentMonthCents / limitCents) * 100) : null` and handle null in the display. Add this guard to both the server action in `src/actions/anthropic-global.ts` (T020) and the component.

---

## Phase 7 — Polish & Cross-Cutting Concerns

*Goal*: Accessibility, empty states, error handling, cron registration, type exports, and vercel.json update.

- [ ] T035 Add empty state to `src/app/claude/page.tsx`. If `getAvailableWorkspaceCostMonths()` returns an empty array (no workspace sync has run yet), render an informational empty state instead of the dashboard — a centered card with a `Bot` icon, heading "No data yet", and description "Workspace cost data will appear after the first sync. You can trigger a sync manually." with a button that calls `syncAnthropicWorkspaces()` via a server action import and shows a Sonner toast.
- [ ] T036 [P] Add a "Last synced" indicator to `src/app/claude/page.tsx`. Query the userId=-1 sentinel row from `anthropicSyncStatus` for its `workspaceSyncCompletedAt` value. Pass it as `lastSyncedAt: Date | null` prop to `<GlobalMetricsClient>`. Render it as a muted caption near the top of the dashboard: "Last synced: X minutes ago" using `date-fns formatDistanceToNow`. If null, render "Never synced".
- [ ] T037 [P] Add Sonner toast error handling to `src/components/claude/workspace-budget-list.tsx` for the `setWorkspaceLimit()` call. On `{ success: false, error }` response, call `toast.error(error)`. On `{ success: true }`, call `toast.success("Workspace limit updated")`. On network/throw error, call `toast.error("Failed to update limit")`. Wrap the submit handler in try/catch.
- [ ] T038 [P] Add Sonner toast error handling to `src/components/claude/org-credits-panel.tsx` for the `setOrgBillingBudget()` call. On `{ success: false, error }` response, call `toast.error(error)`. On `{ success: true }`, call `toast.success("Org billing budget updated")`. Wrap in try/catch with `toast.error("Failed to update budget")` fallback.
- [ ] T039 Export shared TypeScript types to `src/types/index.ts`. Add and export: `GlobalCostDashboardData` (with `dailyTotals`, `workspaceBreakdown`, `grandTotalCents`), `WorkspaceListItem` (from T020 shape), `WorkspaceAlert` (from T024 shape), `ActiveAlertsData` (from T024 return type), `OrgCreditsStatus` (`{ available: false; reason: string }`). Import and use these types in all relevant server actions and components instead of inline type definitions.
- [ ] T040 [P] Document `ANTHROPIC_ADMIN_API_KEY` in `.env.local.example`. Add the variable with a comment: `# Required for workspace sync and global cost reporting (Anthropic Admin API key — distinct from the regular API key)`. Verify no other new environment variables introduced in this feature are missing from `.env.local.example`.
- [ ] T041 [P] Add ARIA accessibility attributes to `src/components/claude/workspace-budget-list.tsx`. Each `<Progress>` bar must have `aria-label="Workspace usage: X%"` and `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`. The workspace cards list should be wrapped in a `<section aria-label="Workspace budgets">`. Inline edit forms must have a visible `<label>` or `aria-label` on the input field.
- [ ] T042 [P] Add ARIA accessibility to the `<Progress>` bar in `src/components/claude/org-credits-panel.tsx`. The billing budget progress must have `aria-label="Org billing usage: X%"` with `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`. The org billing section should be wrapped in `<section aria-label="Organization billing">`.
- [ ] T043 Write unit tests in `tests/unit/anthropic-workspace-sync.test.ts` for `src/lib/anthropic-workspace-sync.ts`. Test: (1) USD-to-cents conversion rounds correctly for fractional cents (e.g., $1.005 → 101 cents), (2) null workspaceId (default workspace) is handled separately from named workspaces, (3) concurrency guard returns `{ skipped: true }` when `workspaceSyncCompletedAt` is within 50 minutes. Mock the Anthropic API fetch and Drizzle DB calls.
- [ ] T044 [P] Write unit tests in `tests/unit/alerts.test.ts` for `src/actions/alerts.ts`. Test: (1) workspace with utilizationPct=79 produces no alert, (2) workspace with utilizationPct=80 produces a "warning" alert, (3) workspace with utilizationPct=100 produces a "critical" alert, (4) function always returns `creditsLow: false` and `creditsCritical: false`. Mock the DB query.

---

## Dependency Graph

```
Phase 1 (Schema)
    └── Phase 2 (Workspace Sync)
            ├── Phase 3 (US1: Dashboard) ← requires sync data to exist
            │       └── Phase 6 (US4: Historical) ← extends Phase 3 client component
            ├── Phase 4 (US2: Alerts)    ← requires workspace cost data + Phase 3 page
            │       └── Phase 5 (US3: Org Budget) ← adds to Phase 3 page, reuses alert infra
            └── Phase 7 (Polish)         ← depends on all prior phases being complete
```

Key sequential constraints:
- T001–T005 (Phase 1) must all complete before T006 (db:push) and Phase 2 begins
- T008–T010 (sync logic) must complete before T011–T012 (cron routes) can be written
- T014 (`getGlobalCostDashboard`) must exist before T016 (page.tsx) can import it
- T016 (page.tsx) must exist before T023 and T031 (adding sections to it)
- T024 (`getActiveAlerts`) must complete before T025 (AlertBanner) and T026 (layout)
- T039 (type exports) should be done before final review but types can be inlined temporarily during development

---

## Parallel Execution Examples

**Phase 1** — T001, T002, T003, T004 can all be written in parallel (different table definitions, same file — coordinate via separate branches or sequential edits, but logically independent). T005 is also independent of T001–T004.

**Phase 2** — T011 (workspace-sync route) and T013 (vercel.json) can be written in parallel with each other once T010 exists. T012 (extend sync route) is independent of T011.

**Phase 3** — T014 and T015 (two actions in same file) must be sequential. T017 (client component) and T018 (sidebar) can be written in parallel with each other. T016 (page.tsx) can be written concurrently with T017 and T018 as a stub that is wired up last.

**Phase 4** — T020 and T021 (two actions in same file) must be sequential. T022 (WorkspaceBudgetList component) and T024 (alerts action) can be written in parallel. T025 (AlertBanner) can be written in parallel with T022. T026 (layout modification) must wait for T024 and T025.

**Phase 5** — T027, T028, T029 are sequential (same file). T030 (OrgCreditsPanel) can be written in parallel with T027–T029 using placeholder types.

**Phase 7** — T036, T037, T038, T040, T041, T042, T043, T044 are all parallelizable (different files).

---

## Implementation Strategy

**MVP delivery order** (minimum viable for US1 demo):
1. Phase 1 (T001–T007) — schema foundation
2. Phase 2 (T008–T013) — sync infrastructure (seeded test data)
3. Phase 3 (T014–T019) — global dashboard with chart and nav item

**Incremental additions**:
4. Phase 4 (T020–T026) — workspace budgets + alert banner (high value, standalone)
5. Phase 5 (T027–T031) — org billing panel (low complexity, builds on Phase 4 patterns)
6. Phase 6 (T032–T034) — historical month picker (low risk, extends existing client component)
7. Phase 7 (T035–T044) — polish, a11y, tests, empty states

**Risk items to address early**:
- The Anthropic Admin API `GET /v1/organizations/cost_report` endpoint must be verified against the actual API before T009 is finalized — confirm pagination structure and field names match the implementation.
- Drizzle partial unique indexes (`WHERE workspaceId IS NULL`) require Drizzle ORM ≥0.30 syntax; verify with `drizzle-orm` version in `package.json` before T001–T003.
- The userId=-1 sentinel row in `anthropicSyncStatus` must be seeded or auto-created on first read in T010 — add an upsert of the sentinel row at the start of `syncAnthropicWorkspaces()` to avoid "row not found" errors on first run.
