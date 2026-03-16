# Tasks: Claude API Cost Tracking

**Input**: Design documents from `/specs/016-claude-api-costs/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database schema, pricing module, and API integration utilities needed by all stories

- [x] T001 Add `anthropic_usage_metrics` and `anthropic_sync_status` tables to Drizzle schema in `src/lib/db/schema.ts` — follow the `copilot_usage_metrics` pattern. `anthropic_usage_metrics`: id, userId (FK→users), date, model, uncachedInputTokens (bigint), cacheReadInputTokens (bigint), cacheCreationInputTokens (bigint), outputTokens (bigint), computedCostCents, pricingResolved, createdAt, updatedAt. Unique constraint on (userId, date, model). `anthropic_sync_status`: id, userId (FK→users, unique), lastSyncStartedAt, lastSyncCompletedAt, lastSyncError, syncedDays, resolvedApiKeyId. Add indexes per data-model.md.
- [ ] T002 Generate and apply database migration for the new tables via `pnpm db:generate && pnpm db:migrate`
- [x] T003 [P] Create Anthropic model pricing lookup module in `src/lib/anthropic-pricing.ts` — export `ModelPricing` type, `MODEL_PRICING` array with prefix-based entries for opus-4, sonnet-4, haiku-4, `resolveModelPricing(model)` function returning `{ pricing, resolved }`, and `computeCostCents(tokens, pricing)` function. Use prefix matching (longest first). Fallback to highest pricing with `resolved: false`.
- [x] T004 [P] Create Anthropic API key resolution module in `src/lib/anthropic-keys.ts` — export `resolveApiKeyId(decryptedKey, orgKeys)` matching by `partial_key_hint` suffix, and `fetchOrgApiKeys()` calling `GET /v1/organizations/api_keys?status=active&limit=100` with `ANTHROPIC_ADMIN_API_KEY`. Add Zod schema for API response validation.
- [x] T005 [P] Add TypeScript types for Anthropic API responses and internal data shapes in `src/types/index.ts` — `AnthropicUsageBucket`, `AnthropicUsageResult`, `CostData`, `DailyBreakdown`, `ProfileData`, etc. per contracts/anthropic-usage-api.md.

**Checkpoint**: Schema deployed, pricing and key resolution modules ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Sync orchestrator and cron endpoint — MUST be complete before user stories can display data

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create Anthropic sync orchestrator in `src/lib/anthropic-sync.ts` — export `runAnthropicSync()` that: (1) resolves all api_key_id→userId mappings from `anthropic_sync_status` (resolve unmapped via `fetchOrgApiKeys`), (2) fetches ALL org usage in one API call (`group_by[]=model&group_by[]=api_key_id&bucket_width=1d`), (3) maps results to users, (4) computes costs via `resolveModelPricing`, (5) upserts into `anthropic_usage_metrics` with `onConflictDoUpdate`. Follow the `copilot-sync.ts` pattern. Handle pagination (`has_more`/`next_page`). Add Zod validation for API response.
- [x] T007 Implement global concurrency guard in `runAnthropicSync()` — check `anthropic_sync_status` for in-progress sync (any row with `lastSyncStartedAt` < 60s ago and no completion), stale lock recovery (> 5 min), atomic lock via `lastSyncStartedAt = now()` on all rows, per-user completion/error tracking.
- [x] T008 Create cron API route in `src/app/api/anthropic/sync/route.ts` — `POST` handler that validates `Authorization: Bearer <CRON_SECRET>`, calls `runAnthropicSync()`, returns JSON summary `{ success, syncedUsers, skippedUsers, errors }`. Follow the exact pattern of `src/app/api/copilot/sync/route.ts`.
- [x] T009 Create server actions in `src/actions/anthropic-usage.ts` — (1) `getUserCostData(userId, month?)`: reads `computedCostCents` from `anthropic_usage_metrics` for the selected month, returns `CostData` shape with `monthlyTotalCents`, `dailyBreakdown`, `latestDataDate`, `hasUnresolvedPricing`. (2) `syncAnthropicUsage(userId)`: admin-only single-user sync via `requireAdmin()`, fetches filtered by `api_key_ids[]=<resolvedApiKeyId>`. (3) `recalculateUnresolvedCosts()`: admin-only, recomputes `computedCostCents` for all `pricingResolved = false` rows.
- [x] T010 Create `getProfileData(userId)` server action in `src/actions/anthropic-usage.ts` — fetches user info, assignments (via existing `getUserAssignments`), and cost data (via `getUserCostData`). Returns `ProfileData` type. Handles missing API key (returns `costData.available = false` with error message).

**Checkpoint**: Cron sync works end-to-end. Server actions return cost data from DB. Foundation ready for UI.

---

## Phase 3: User Story 1 — Access Personal Profile Page (Priority: P1) 🎯 MVP

**Goal**: Authenticated users can access their own read-only profile page showing personal info and assigned tools/licenses.

**Independent Test**: Log in as any user → click "My Profile" in sidebar → see own name, email, role, and assigned tools. Cannot access another user's profile.

### Implementation for User Story 1

- [x] T011 [US1] Create profile page server component in `src/app/profile/page.tsx` — get session via `auth()`, redirect to login if unauthenticated, call `getProfileData(userId)`, pass data to client component. Server component handles data fetching only.
- [x] T012 [US1] Create profile page client component in `src/app/profile/profile-client.tsx` — `"use client"`, receives `ProfileData` as prop. Renders profile header, assignments section, and cost tracking section (placeholder for Phase 4). Use Card components from shadcn/ui.
- [x] T013 [P] [US1] Create profile header component in `src/components/profile/profile-header.tsx` — displays user name, email, role badge, and profile badge in read-only format. Reuse badge styling from existing `user-detail-client.tsx`. Use shadcn Card, Badge components.
- [x] T014 [P] [US1] Create profile assignments component in `src/components/profile/profile-assignments.tsx` — displays user's assigned tools/licenses in a read-only list. Show tool name, tier name, assignment date, status badge. Use shadcn Card, Table, Badge components. Show empty state if no assignments.
- [x] T015 [US1] Add "My Profile" link to sidebar user dropdown in `src/components/app-sidebar.tsx` — convert the existing user name/role footer area into a `DropdownMenu` with "My Profile" (links to `/profile`) and "Sign Out" options. Use shadcn DropdownMenu, DropdownMenuItem. Keep ThemeToggle in the dropdown.
- [x] T016 [US1] Add access control to profile page — in `src/app/profile/page.tsx`, ensure the page only shows the authenticated user's own data (no `[id]` param, always uses session userId). If someone navigates to `/profile` without auth, redirect to `/api/auth/signin`.

**Checkpoint**: Users can navigate to their profile via sidebar dropdown and see their info + assigned tools. Profile is read-only and self-only.

---

## Phase 4: User Story 2 — View Monthly Total Cost with Month Picker (Priority: P1)

**Goal**: Users see their total cost for a selected month (defaulting to current) with a month picker to browse historical data.

**Independent Test**: Log in as user with synced cost data → navigate to profile → see current month's total cost → switch to a past month via picker → see that month's total.

### Implementation for User Story 2

- [x] T017 [P] [US2] Create month picker component in `src/components/profile/month-picker.tsx` — `"use client"`, renders a select/dropdown of available months (from `latestDataDate` back to earliest stored data). Defaults to current month. Emits `onMonthChange(month: string)` callback. Use shadcn Select or Popover with calendar.
- [x] T018 [US2] Create cost tracking section component in `src/components/profile/cost-tracking-section.tsx` — `"use client"`, contains month picker, monthly total display (formatted as USD via `formatCurrency`), daily chart (placeholder for Phase 5), and latest data date indicator. Handles three states: (1) no API key configured → show message to contact admin, (2) no usage data → show $0.00 empty state, (3) data available → show total + chart. Fetches cost data for selected month via server action when month changes.
- [x] T019 [US2] Wire cost tracking section into profile page — update `src/app/profile/profile-client.tsx` to render `CostTrackingSection` with initial cost data from server, passing the data and a `refreshCostData(month)` callback that calls `getUserCostData`.
- [x] T020 [US2] Handle API key not configured state — in `src/components/profile/cost-tracking-section.tsx`, when `costData.available === false`, show an Alert component with message "No Claude API key configured. Contact your administrator to set up cost tracking." Use shadcn Alert with Lucide InfoIcon.
- [x] T021 [US2] Handle unresolved pricing indicator — when `costData.hasUnresolvedPricing === true`, show a subtle warning banner: "Some usage data may have approximate costs due to unrecognized models." Use shadcn Alert variant="warning".

**Checkpoint**: Users see their monthly total cost, can switch months, and see appropriate empty/error states.

---

## Phase 5: User Story 3 — View Daily Token Costs with Visual Chart (Priority: P1)

**Goal**: Users see a daily breakdown of costs by model as a stacked bar chart with tooltips, integrated into the cost tracking section.

**Independent Test**: Log in as user with multi-model usage → see stacked bar chart with per-model colors → hover over a bar → tooltip shows exact cost and model breakdown for that day.

### Implementation for User Story 3

- [x] T022 [US3] Create cost chart component in `src/components/cost-chart.tsx` — `"use client"`, renders a Recharts stacked `BarChart` inside shadcn `ChartContainer`. X-axis: dates. Y-axis: cost in USD. One stacked bar segment per model. Use `ChartConfig` with `var(--chart-N)` colors per model. Include `ChartLegend` + `ChartLegendContent`. Add `accessibilityLayer` prop for a11y. Follow the existing pattern from `src/components/copilot/usage-trend-chart.tsx`.
- [x] T023 [US3] Add chart tooltips — use shadcn `ChartTooltip` + `ChartTooltipContent` with custom formatter showing model name and cost formatted as USD for each segment, plus daily total. Follow existing tooltip patterns.
- [x] T024 [US3] Integrate cost chart into cost tracking section — update `src/components/profile/cost-tracking-section.tsx` to render `CostChart` below the monthly total, passing `dailyBreakdown` data. Transform `dailyBreakdown` into Recharts-compatible format: `Array<{ date: string; [modelName]: number }>`. Handle empty data gracefully (hide chart when no data).
- [x] T025 [US3] Add supporting data below chart — render a compact summary below the chart showing: total for the month, number of active days, top model by cost. Use shadcn Card with grid layout.

**Checkpoint**: Full cost tracking view works — monthly total, month picker, daily chart with tooltips, and summary data.

---

## Phase 6: Admin Cost View on User Detail Page

**Goal**: Admins can see a user's Claude API cost data on the existing admin user detail page, plus trigger a manual sync.

**Independent Test**: Log in as admin → navigate to a user's detail page → see their cost data (same chart/table as profile) → click "Sync" to trigger a fresh sync for that user.

### Implementation

- [x] T026 [P] Create reusable admin cost section component in `src/components/profile/admin-cost-section.tsx` — wraps `CostChart` and monthly total display for use in the admin context. Accepts `userId` prop and fetches cost data server-side. Includes a "Sync Now" button that calls `syncAnthropicUsage(userId)` server action with loading state and toast feedback.
- [x] T027 Update admin user detail server component in `src/app/users/[id]/page.tsx` — fetch cost data for the viewed user via `getUserCostData(userId)` and pass to client component as a new prop.
- [x] T028 Update admin user detail client component in `src/app/users/[id]/user-detail-client.tsx` — add a new "Claude API Costs" section (using the admin cost section component) below the existing "Assigned Tools" section. Show empty state if user has no API key configured (no prompt to add one per spec edge case). Include manual sync button for admins.

**Checkpoint**: Admins can view any user's cost data and trigger manual syncs from the user detail page.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility, loading states, and validation

- [x] T029 [P] Add loading states to profile page — add Suspense boundaries and skeleton components for profile header, assignments, and cost tracking section in `src/app/profile/page.tsx` and `src/app/profile/profile-client.tsx`. Use shadcn Skeleton component.
- [ ] T030 [P] Verify accessibility — ensure chart has `accessibilityLayer`, all interactive elements are keyboard navigable, color is not sole indicator (legend labels present), focus rings on month picker and buttons. Test with screen reader.
- [ ] T031 Validate end-to-end flow per quickstart.md — set `ANTHROPIC_ADMIN_API_KEY` env var, trigger cron sync, verify data appears on profile page, verify admin can see and sync user data.
- [x] T032 Update `src/components/profile/cost-tracking-section.tsx` to show "Data last synced: [date]" indicator using `latestDataDate` from cost data response.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - US1 (Profile Page) can start independently after Phase 2
  - US2 (Monthly Total) depends on US1 (needs the profile page container)
  - US3 (Daily Chart) depends on US2 (needs the cost tracking section container)
- **Admin Cost View (Phase 6)**: Depends on Phase 2 (server actions) + Phase 5 (chart component to reuse)
- **Polish (Phase 7)**: Depends on all previous phases

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependencies on other stories
- **User Story 2 (P1)**: Depends on US1 (profile page must exist as container)
- **User Story 3 (P1)**: Depends on US2 (cost tracking section must exist)
- **Admin View**: Depends on Phase 2 + US3 (reuses chart component)

### Within Each User Story

- Models/components before integration
- Parallel tasks ([P]) can run concurrently
- Commit after each task or logical group

### Parallel Opportunities

- T003, T004, T005 can all run in parallel (Phase 1 — different files)
- T013, T014 can run in parallel (Phase 3 — independent components)
- T017 can run in parallel with other US2 prep (Phase 4)
- T026 can run in parallel with other Phase 6 tasks
- T029, T030 can run in parallel (Phase 7 — different concerns)

---

## Parallel Example: Phase 1 Setup

```bash
# Launch these three tasks together (different files, no dependencies):
Task T003: "Create pricing module in src/lib/anthropic-pricing.ts"
Task T004: "Create key resolution module in src/lib/anthropic-keys.ts"
Task T005: "Add TypeScript types in src/types/index.ts"
```

## Parallel Example: User Story 1

```bash
# Launch profile sub-components together (different files):
Task T013: "Create profile-header.tsx"
Task T014: "Create profile-assignments.tsx"
# Then integrate into the profile page (depends on both):
Task T012: "Create profile-client.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (schema, pricing, keys)
2. Complete Phase 2: Foundational (sync orchestrator, cron route, server actions)
3. Complete Phase 3: User Story 1 (profile page with info + assignments)
4. **STOP and VALIDATE**: Profile page works, users can navigate to it
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Cron sync works, data flows into DB
2. Add US1 (Profile Page) → Users can see their info and assignments
3. Add US2 (Monthly Total + Month Picker) → Users see cost totals, can browse months
4. Add US3 (Daily Chart) → Full cost visualization with chart
5. Add Admin View → Admins see costs on user detail page + manual sync
6. Polish → Loading states, accessibility, validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each task or logical group
- The cron sync (Phase 2) should be verified working before starting UI work
- All cost data is read from the database — the profile page never calls the Anthropic API directly
- Follow existing patterns: `copilot-sync.ts` for sync, `copilot/usage-trend-chart.tsx` for charts, `user-detail-client.tsx` for admin page
