# Tasks — Spec 026: Claude page redesign

All three phases ship in **one PR** as three sequential commits. Tasks within a phase are ordered for execution; check off in order.

## Delivery model

All 3 phases ship in a **single pull request**, organized as **3 sequential commits** so review can be staged phase-by-phase. Commits are intentionally ordered so each is independently revertible without breaking the previous: commit 1 leaves the page functional, commit 2 adds the historical card additively, commit 3 adds the new route + small schema migration.

Run `pnpm lint && pnpm typecheck && pnpm test` between each commit, not just at the end.

## Phase 1 — Visual reset + KPI strip (Commit 1)

### Data layer
- [ ] T101 Extend `getGlobalCostDashboard` return type with `kpis: DashboardKpis` and `dailyStacked: DailyStackedRow[]` in `src/types/index.ts`.
- [ ] T102 Implement `getDashboardKpis(month?)` server action in `src/actions/anthropic-global.ts`. Cache tag `"anthropic-workspace-costs"`. Includes MoM math (return `null` when prior month < $1) and `projectMonthEnd()`.
- [ ] T103 Implement `getDailyTotalsByWorkspace(month?)`. Reshape existing `workspaceBreakdown` into per-day stacked rows: top 8 workspaces + `Other`. **Top-8 rule (decided in spec review)**: rank by `SUM(cost_cents)` for the selected period — re-computed per render based on the month being viewed; ties broken by workspace name ASC. Same cache tag.
- [ ] T104 Implement `getSyncStatus()` reading the `userId = 0` sentinel row from `anthropicSyncStatus` (per `LOCK_USER_ID` in `src/lib/anthropic-sync.ts:23`). Returns `{ lastSyncedAt, ageMinutes, isStale }` with `isStale` = age > 70 minutes.
- [ ] T105 Add shared util `projectMonthEnd(mtdCents, daysElapsed, daysInMonth)` in `src/lib/utils.ts` + unit tests.
- [ ] T106 Unit tests: `tests/unit/anthropic-global-kpis.test.ts` — MoM math, projection math, over-80% counting, staleness boundary.
- [ ] T107 Integration test: seed two months of workspace costs, verify `getDashboardKpis` shape.

### UI layer
- [ ] T108 Rename header in `src/app/claude/page.tsx` (line 21 metadata, line 55 h1) → "Claude API Spending"; update sidebar nav label in `src/components/app-sidebar.tsx`.
- [ ] T109 New `SyncStatusPill` component in `src/components/claude/sync-status-pill.tsx`. Green / amber / grey states per `isStale` flag. Anchored to `/settings/sync`.
- [ ] T110 New `KpiStrip` component (`src/components/claude/kpi-strip.tsx`) — 4 tiles in `md:grid-cols-2 lg:grid-cols-4`. Tile 3 gets red ring + warning icon if `projectedMonthEndCents > orgBudget`. Tile 4 shows over-80% count out of `workspacesWithLimitCount`.
- [ ] T111 Update `GlobalMetricsClient` to render `KpiStrip` above the chart. Pass through new props.
- [ ] T112 Convert the daily chart in `global-metrics-client.tsx` from single-series to stacked Bar (`stackId="costs"`, one `<Bar>` per top-8 workspace + `Other`). Legend on top. Tooltip shows per-workspace breakdown.
- [ ] T113 Refactor `OrgCreditsPanel` → `OrgBillingBudgetCard`: drop the dead Credit Balance card; full-width; add a Projected month-end column. Move credits stub to a footnote link.
- [ ] T114 Update `WorkspaceBudgetList` sort consumer + add "Hide $0 + no limit" toggle (default on, persisted to `localStorage` key `claude-hide-zero-workspaces`).
- [ ] T115 Update SQL in `_getWorkspaceList` to sort: over-limit first, over-80% next, with-limit by utilization DESC, no-limit by spend DESC, $0+no-limit last.
- [ ] T116 Visual restructure of `WorkspaceBudgetRow`: spend big on left, limit small on right; drill-through icon button on hover (no-op until Phase 3 ships).

### Verification
- [ ] T117 E2E: `tests/e2e/claude-page-phase1.spec.ts` — admin lands on `/claude`, sees new title, 4 KPI tiles, sync pill, stacked chart legend, toggle persists across reload, non-admin gets redirected.
- [ ] T118 Manual: with the dev DB, confirm "Automations" appears at row 1 (over budget), KPI tile 4 is in warning color, projected tile shows the red ring.

## Phase 2 — Historical trend + sparklines (Commit 2)

### Data layer
- [ ] T201 New action `getTwelveMonthTotals()` in `anthropic-global.ts`. SQL: `GROUP BY date_trunc('month', date)` for last 12 months. Returns budget cap alongside each row (uses current `anthropic_org_config` value — no history is retained, consistent with spec 018).
- [ ] T202 New action `getCumulativePacing()` — window function over 4 months: `SUM(cost_cents) OVER (PARTITION BY date_trunc('month', date) ORDER BY date)`. Pivot per `dayOfMonth`. Pad missing days with `null` so Recharts skips them cleanly.
- [ ] T203 New action `getTopMovers()` — top 3 by **positive** % delta only (newest 3-month vs oldest 3-month windows), with `>= $5` floor on the prior period to filter noise. **Decline / drops are filtered out** (decided in spec review — user-facing label is "Fastest growing"). Internal function/type names may stay as `getTopMovers` / `TopMover` for git history continuity.
- [ ] T204 New action `getWorkspaceSparklines()` — single query: 6 months of monthly totals grouped by `(workspace_id, month)`, pivoted server-side into `Record<workspaceId, {month, totalCents}[]>`.
- [ ] T205 New types in `src/types/index.ts`: `TwelveMonthRow`, `PacingRow`, `TopMover`, `WorkspaceSparkline`.
- [ ] T206 Unit tests: cumulative pacing math, top-movers ranking + floor, 12-month bucketing across year boundaries.
- [ ] T207 Integration test: seed 6 months across multiple workspaces; verify sparkline shape and top movers ranking.

### UI layer
- [ ] T208 New `HistoricalTrendCard` container in `src/components/claude/historical-trend-card.tsx` with a 3-way segmented control (Monthly totals / Pacing / **Fastest growing**).
- [ ] T209 New `TwelveMonthBarChart` (`twelve-month-bar-chart.tsx`) — Recharts BarChart + horizontal dashed budget-cap line; bars exceeding cap get a red top stroke.
- [ ] T210 New `CumulativePacingChart` (`cumulative-pacing-chart.tsx`) — Recharts LineChart with 4 series. Current month bold; prior 3 in cool greys. Synchronized tooltip across all series.
- [ ] T211 New `TopMoversChips` (`top-movers-chips.tsx`) — 3 chips with name + ▲ arrow + delta %. Section title is **"Fastest growing (6mo)"** (user-facing label decided in spec review). All chips render with ▲ since the action filters to positive deltas only. Until Phase 3 ships, chips are non-interactive static badges.
- [ ] T212 New `Sparkline` primitive in `src/components/ui/sparkline.tsx`. Hand-rolled inline SVG `<polyline>` — not Recharts — to avoid 13× instance overhead. Props: `data`, `color?`, `height?`, `width?`. Renders `—` when `data.length < 2`.
- [ ] T213 Add `<Sparkline>` column to `WorkspaceBudgetRow` (between spend and progress bar). Reuse `displayColor` from `anthropic_workspaces`.
- [ ] T214 Wire all 4 new actions into `page.tsx` Promise.all and pass into the chart card + workspace list.

### Verification
- [ ] T215 E2E: navigate to `/claude`, confirm Historical Trend card renders, tabs switch views, sparkline column populated.
- [ ] T216 Manual: with dev DB confirm Automations sparkline ramps up; Top Movers shows Automations + boost-starter-5 + boost-starter-3.

## Phase 3 — Drill-through (Commit 3)

### Schema migration (small, deterministic — no spike)

- [ ] T301 Add Zod field: extend `orgApiKeySchema` in `src/lib/anthropic-keys.ts` (lines 5-11) to capture `workspace_id: z.string().nullable()`. Anthropic's `/v1/organizations/api_keys` already returns it — codebase currently discards it.
- [ ] T302 Drizzle migration `drizzle/NNNN_anthropic_sync_workspace_id.sql`: `ALTER TABLE anthropic_sync_status ADD COLUMN resolved_workspace_id varchar(100);`. Generate via `pnpm db:generate` after updating the schema in `src/lib/db/schema.ts`.
- [ ] T303 Update `src/lib/db/schema.ts`: add `resolvedWorkspaceId: varchar("resolved_workspace_id", { length: 100 })` to the `anthropicSyncStatus` table definition.
- [ ] T304 Update `resolveAllMappings()` in `src/lib/anthropic-sync.ts` (lines 143-221): when persisting `resolvedApiKeyId`, also persist the corresponding `workspace_id` from the `orgKeys` array into `resolved_workspace_id`. Backfill happens automatically on the next hourly sync — no manual backfill required.
- [ ] T305 Verify in dev DB: after one sync run, every active user's `anthropic_sync_status` row should have a non-null `resolved_workspace_id` (NULL only for the org's default workspace).

### Data layer

- [ ] T306 New action `getWorkspaceDetail(workspaceId | "default", month?)` in `anthropic-global.ts` returning `{ workspace, currentMonthCents, limitCents, utilizationPct, dailyTotals, topUsers, modelBreakdown }`. Cache tag `"anthropic-workspace-costs"`. Top users query joins `anthropic_usage_metrics` → `anthropic_sync_status.user_id` → `resolved_workspace_id`. Model breakdown aggregates `anthropic_usage_metrics.model` filtered by the same join.
- [ ] T307 New action `getWorkspaceMonths(workspaceId | "default")` for the per-workspace month picker.
- [ ] T308 Type additions in `src/types/index.ts`: `WorkspaceDetail`, `WorkspaceUser`, `ModelBreakdownRow`.
- [ ] T309 Unit + integration tests for `getWorkspaceDetail`, including the `"default"` URL sentinel → null SQL value round-trip.

### UI layer

- [ ] T310 New route `src/app/claude/workspaces/[workspaceId]/page.tsx` (Server Component, admin gate, parses `"default"` sentinel → `null`).
- [ ] T311 New `WorkspaceDetailClient` (client wrapper) — month picker + KPI strip scoped to this workspace. **Reuses Phase 1 `KpiStrip`** with these 4 tiles (decided in spec review): (1) Total MTD · (2) MoM delta · (3) Projected month-end · (4) **Utilization %** (replaces the org-level "Over 80% count" tile). When `limitCents IS NULL`, tile 4 shows "No limit set" with an inline action calling `setWorkspaceLimit`.
- [ ] T312 New `WorkspaceDailyChart` — single-series Recharts BarChart.
- [ ] T313 New `WorkspaceTopUsers` — table with `User | Requests | Cost`; row click opens the user's existing profile cost page in a new tab. Show a footnote that the per-user sum does not reconcile with the workspace total (different Anthropic endpoints).
- [ ] T314 New `WorkspaceModelBreakdown` — horizontal stacked bar + legend table (model, tokens in/out, cost, % of workspace).
- [ ] T315 Make `WorkspaceBudgetRow` a `<Link>` to the detail page. Reuse the drill icon added in Phase 1.
- [ ] T316 Make `TopMoversChips` navigable. Update breadcrumb on detail page to support back-navigation with `?workspace=` query param preserved on `/claude`.

### Verification

- [ ] T317 E2E: `tests/e2e/claude-workspace-detail.spec.ts` — list → row click → detail page renders → breadcrumb back restores filter. Non-admin direct-nav redirects. 404 on bad ID.
- [ ] T318 Manual smoke: walk through `/claude/workspaces/default` (URL sentinel for NULL workspace_id), a real workspace ID, and a non-existent ID.

## Cross-cutting checklist (each commit)

- [ ] Cache tag `"anthropic-workspace-costs"` on every new server action so the existing hourly sync `revalidateTag` calls invalidate them.
- [ ] All new types exported from `src/types/index.ts`.
- [ ] `pnpm lint && pnpm typecheck` clean.
- [ ] Lighthouse mobile + desktop pass on `/claude` (Phase 1 + 2 only).
- [ ] Update `docs/admin-guide.md` (or equivalent) with screenshots after Phase 1.
