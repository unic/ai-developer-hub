# Tasks — Spec 027: Claude Console Users sub-page

All three phases ship in **one PR** as three sequential commits, mirroring spec 026's delivery model. Tasks within a phase are ordered for execution; check off in order.

## Delivery model

Three phases, one PR, three commits. Each commit leaves the page functional and independently revertible:

1. Commit 1 introduces the tabbed sub-page nav and the MVP Users page; nothing on the existing Workspaces view changes shape (only the header gets the tab strip).
2. Commit 2 adds the Phase 2 cards (distribution, top movers, sparklines, daily-spend-by-user) additively.
3. Commit 3 adds the new `/claude/users/[userId]` route and rewires the existing `target="_blank"` link in the workspace top-users table.

Run `pnpm lint && pnpm typecheck && pnpm test` between each commit, not just at the end.

## Phase 1 — Sub-page nav + Users MVP (Commit 1)

### Routing + nav

- [ ] T101 New route `src/app/claude/users/page.tsx`. Server Component, admin gate identical to `src/app/claude/page.tsx:28-31`. Exports `metadata: { title: "Claude Console · Users" }`.
- [ ] T102 New shared `ClaudeTabs` component in `src/components/claude/claude-tabs.tsx`. Two tabs: Workspaces (`/claude`) · Users (`/claude/users`). Uses `usePathname()` to mark the active tab. Renders inline below the page header on both routes.
- [ ] T103 Render `<ClaudeTabs />` on both `src/app/claude/page.tsx` and `src/app/claude/users/page.tsx` directly below the existing `<h1>` block. The sync pill and Trigger Sync button stay on the same row as the title; the tab strip sits below them, full-width.
- [ ] T104 Sidebar nav stays a single "Claude Console" entry (`src/components/app-sidebar.tsx:58`). Active state should cover both `/claude` and `/claude/users` — already does because the entry is `href: "/claude"` and active matching is by prefix.

### Data layer

- [ ] T105 New action `getUserList(month?: string)` in `src/actions/anthropic-users.ts` (new file). Returns `{ users: UserListRow[], totalCents, periodStart, periodEnd, hasUnresolvedPricing }`. SQL is the canonical query in `data-model.md`; cache tag `"anthropic-workspace-costs"`.
- [ ] T106 New action `getUsersDashboardKpis(month?: string)` in the same file. Computes the four KPI tiles (active users + MoM delta · top spender · top-5 concentration · users with no API key). Cache tag `"anthropic-workspace-costs"`.
- [ ] T107 New action `getAvailableUserMonths()` — returns `string[]` of `YYYY-MM` months that have at least one row in `anthropic_usage_metrics`. Same pattern as `getAvailableWorkspaceCostMonths`.
- [ ] T108 New types in `src/types/index.ts`: `UserListRow`, `UsersDashboardKpis`. Keep field names parallel to `WorkspaceListRow` / `DashboardKpis` where possible.
- [ ] T109 Exclude `LOCK_USER_ID = 0` from every query in `anthropic-users.ts`. Promote the literal `0` to a re-export of the existing `LOCK_USER_ID` constant from `src/lib/anthropic-sync.ts:23` so the two stay in lockstep.
- [ ] T110 Unit tests: `tests/unit/anthropic-users-kpis.test.ts` — top-5 concentration math (handles the 0 / 1 / 4 / 5+ user cases), MoM count math, users-with-no-api-key denominator.

### UI layer

- [ ] T111 New `UserKpiStrip` component in `src/components/claude/user-kpi-strip.tsx`. Reuse the `KpiStrip` primitive from spec 026 (`src/components/claude/kpi-strip.tsx`); pass the four user-flavoured tiles in. The Top spender tile links to that user's row in the table below (anchor scroll).
- [ ] T112 New `TopUsersBarChart` (`src/components/claude/top-users-bar-chart.tsx`) — horizontal Recharts BarChart, top 10 users by cost, descending. Each row shows name + tokens + cost. Click a bar = navigate to `/profile?userId=N` (Phase 3 will rewire to `/claude/users/[userId]`). Bar fill uses the workspace `display_color` of the user's resolved workspace; users with no workspace get muted grey.
- [ ] T113 New `UsersTable` (`src/components/claude/users-table.tsx`) — TanStack Table 8 with columns: User (name + email) · Workspace · Models used · Tokens · Cost MTD · Last active · Drill (chevron). Sortable on every numeric column. Default sort: Cost DESC, email ASC (tiebreaker).
- [ ] T114 Filters above the table: workspace `<Select>` (multi), circle `<Select>` (multi), profile tier `<Select>` (multi), "Hide $0 users" toggle (default ON, persisted to `localStorage` key `claude-users:hide-zero`), search input (filters on name + email substring, debounced 200ms).
- [ ] T115 Empty state: when `users.length === 0` after filtering, render a "No matching users" panel with a "Clear filters" button. When the table is empty *before* filtering (no data at all), render the same `<EmptyState />` component the Workspaces tab uses (`src/app/claude/page.tsx:123-135`) but with a users-flavoured copy.
- [ ] T116 Row drill: every row has a chevron `<Link>` to `/profile?userId={id}` (no `target="_blank"` — admins are navigating within the dashboard). Phase 3 rewires the href to `/claude/users/{id}`.

### Verification

- [ ] T117 E2E: `tests/e2e/claude-users-phase1.spec.ts` — admin lands on `/claude/users`, sees 4 KPI tiles, top 10 chart, filterable table; tab strip switches between Workspaces and Users; non-admin gets redirected.
- [ ] T118 Manual: with the dev DB, confirm the top spender tile matches the first row of the table; "users with no API key" count matches a hand-rolled SQL spot-check; tab strip persists scroll position when switching.

## Phase 2 — Distribution + sparklines + Top movers (Commit 2)

### Data layer

- [ ] T201 New action `getUserCostDistribution(month?: string)` in `anthropic-users.ts`. Returns counts in buckets: `$0`, `$0.01–$1`, `$1–$10`, `$10–$50`, `$50–$100`, `$100+`. Bucket boundaries are constants exported from `src/lib/claude-users-buckets.ts` (single source of truth so the histogram axis labels and the SQL stay aligned).
- [ ] T202 New action `getUserSparklines(monthsBack: number = 6)` — pattern-matches `getWorkspaceSparklines()` from spec 026. Returns `Record<userId, { month, totalCents }[]>`. Single SQL round-trip; pivot in the action.
- [ ] T203 New action `getUserTopMovers()` — copy of `getTopMovers()` (spec 026) but grouping by `user_id` rather than `workspace_id`. Same `>= $5` floor on prior 3-month window, same positive-deltas-only filter. Returns `UserTopMover[]` (name + email + prior cents + recent cents + delta pct).
- [ ] T204 New action `getDailyTotalsByUser(month?: string)` — pattern-matches `getDailyTotalsByWorkspace()`. Top-5 users by period cost; everyone else collapses into `Other`. Same per-day shape Recharts expects for a stacked bar.
- [ ] T205 New types: `UserCostDistributionBucket`, `UserSparkline`, `UserTopMover`, `DailyByUserRow`.
- [ ] T206 Unit tests: cost-distribution bucket boundaries (inclusive / exclusive edges), sparkline pivot integrity, top-movers ranking matches the workspace version.

### UI layer

- [ ] T207 New `CostDistributionHistogram` (`src/components/claude/cost-distribution-histogram.tsx`) — vertical bar chart, 6 buckets, x-axis labels are dollar ranges, y-axis is user count. Each bar shows the count above it. Bars are colour-graded from muted to warning to danger as the dollar bucket increases (visual reinforcement that the right tail is the expensive tail).
- [ ] T208 New `UserTopMoversChips` (`src/components/claude/user-top-movers-chips.tsx`) — 3 chips with name + ▲ arrow + delta %. Section label is "Fastest growing users (6mo)". Chips are clickable and navigate to the user's drill page (Phase 3) — for Commit 2 they fall back to `/profile?userId=N`.
- [ ] T209 Add a `Sparkline` column to `UsersTable` reusing the existing `Sparkline` primitive from spec 026 (`src/components/ui/sparkline.tsx`). Colour: muted grey (no per-user display colour exists). Render `—` for fewer than 2 data points.
- [ ] T210 New `DailyByUserChart` — wraps the existing stacked-bar pattern from `global-metrics-client.tsx`. Top 5 users + Other. Legend on top. The existing "Use workspace colors" toggle does not apply here (no per-user colour); instead, paint by rank using the same spectral palette from `c33d8f6`.
- [ ] T211 Insert the Phase 2 cards into `src/app/claude/users/page.tsx`:
  - `<DailyByUserChart />` directly below the KPI strip (replaces the Top 10 chart's top-of-page slot; Top 10 moves below).
  - `<CostDistributionHistogram />` and `<UserTopMoversChips />` in a `lg:grid-cols-2` row, between Top 10 and the table.
- [ ] T212 Make `UserTopMoversChips` interactive: clicking a chip filters the table to that user (sets the search input).

### Verification

- [ ] T213 E2E: `tests/e2e/claude-users-phase2.spec.ts` — distribution histogram renders with 6 bars summing to total users; sparkline column populated for users with >= 2 months of data; top movers chip click filters the table.
- [ ] T214 Manual: with dev DB confirm one user dominates the right-tail bucket (matches the workspace-level "Automations" pattern), top movers shows the same names as the workspace top-movers in many cases, sparklines render for the top 5 users.

## Phase 3 — Per-user drill-through (Commit 3)

### Data layer

- [ ] T301 New action `getUserDetail(userId: number, month?: string)` in `anthropic-users.ts`. Returns `{ user, month, periodStart, periodEnd, currentMonthCents, priorMonthCents, momDeltaCents, momDeltaPct, projectedMonthEndCents, dailyTotals, modelBreakdown, topDates, twelveMonth, workspace }`. Cache tag `"anthropic-workspace-costs"`. Reuses helpers from `anthropic-global.ts` where they are user-agnostic (`projectMonthEnd`, `aggregateDailyCosts` token-shape).
- [ ] T302 New action `getUserMonths(userId: number)` — months with data for this user, for the month picker.
- [ ] T303 Types in `src/types/index.ts`: `UserDetail`, `UserModelBreakdownRow`, `UserDailyRow`, `UserTopDateRow`.
- [ ] T304 Unit tests: `getUserDetail` for the "no data" edge case (active user, zero usage), pricing-unresolved warning surfaces, daily totals match `SUM(computed_cost_cents)` in spot-check.

### UI layer

- [ ] T305 New route `src/app/claude/users/[userId]/page.tsx` (Server Component, admin gate, parses `userId` as integer, `notFound()` on non-integer or non-existent user).
- [ ] T306 New `UserDetailClient` (client wrapper) — month picker + KPI strip scoped to the user. Reuses the `KpiStrip` primitive with these 4 tiles: (1) Total MTD · (2) MoM delta · (3) Projected month-end · (4) Top model + its % of the user's cost.
- [ ] T307 New `UserDailyChart` — single-series Recharts BarChart, same polish as `WorkspaceDailyChart` (max bar size 56, sub-dollar Y-axis formatter when daily max < $5).
- [ ] T308 New `UserModelBreakdown` — horizontal stacked bar + legend table (model, tokens in/out, cost, % of user). Reconciliation footnote mirroring spec 026.
- [ ] T309 New `UserTwelveMonthBarChart` — 12-month bar chart per user, reusing the `TwelveMonthBarChart` primitive from spec 026 with the org-budget reference line stripped (per-user budget caps are out of scope; the reference line would be misleading).
- [ ] T310 New `UserTopDates` — small table: 5 highest-spend days for the user in the current month, with date + cost + the dominant model.
- [ ] T311 Page header: breadcrumb back to `/claude/users` (preserves the user's filter via `?circle=` / `?workspace=` if those came from the URL), user name + email + workspace chip + profile tier chip (boost/maxed/indie). Identical layout principles to `src/app/claude/workspaces/[workspaceId]/page.tsx:38-69`.
- [ ] T312 Rewire `WorkspaceTopUsers` (`src/components/claude/workspace-top-users.tsx:33-44`): replace `href={\`/profile?userId=${u.userId}\`}` and `target="_blank"` with `href={\`/claude/users/${u.userId}\`}` (no new tab — same navigation flow as the workspace drill-through). The existing footnote about reconciliation stays.
- [ ] T313 Update `TopUsersBarChart` bar onClick to navigate to `/claude/users/{userId}`. Update `UsersTable` chevron and row click similarly. Update `UserTopMoversChips` (Phase 2) chip href similarly.

### Verification

- [ ] T314 E2E: `tests/e2e/claude-users-detail.spec.ts` — list → row click → detail page renders → breadcrumb back. Non-admin direct-nav redirects. 404 on bad userId.
- [ ] T315 Manual smoke: walk through `/claude/users/{N}` for an admin user (heavy spender), an inactive user (zero spend), and a user with no Anthropic API key (everything zero, "no data" empty states).

## Cross-cutting checklist (each commit)

- [ ] Cache tag `"anthropic-workspace-costs"` on every new server action so the existing hourly sync `revalidateTag` calls invalidate them.
- [ ] All new types exported from `src/types/index.ts`.
- [ ] `pnpm lint && pnpm typecheck` clean.
- [ ] Lighthouse mobile + desktop pass on `/claude/users` (Phase 1 + 2 only — Phase 3 detail page is admin-only and out of the public Lighthouse budget).
- [ ] Update `docs/admin-guide.md` (or equivalent) with a screenshot of the Users tab after Phase 1.

## Deployment notes

No new migrations introduced by spec 027. But the page surfaces a data
gap inherited from spec 026: the workspace column on the Users table will
show "Default Workspace" for every user whose `anthropic_sync_status` row
predates migration 0018 (i.e. whose `resolved_workspace_id` was never
populated). After deploying the PR, run the existing spec-026 backfill
once — idempotent and safe to re-run:

```
pnpm tsx --env-file=.env.local scripts/backfill-anthropic-workspace-mapping.ts
```

Then verify:

1. Confirm the tab strip renders on both `/claude` and `/claude/users`.
2. Confirm the Top spender tile and the first table row agree.
3. Confirm the workspace cell in the table matches the workspace drill page's top-users panel for at least one spot-check user (this is the canary for whether the backfill ran).
4. Watch for `pricingResolved = false` warnings in the table for the first 24 hours — if any new model rolled out between deploy and verification, the warning chip should surface.
