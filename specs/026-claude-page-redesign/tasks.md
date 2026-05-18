# Tasks — Spec 026: Claude page redesign

All three phases ship in **one PR** as three sequential commits. Tasks within a phase are ordered for execution; check off in order.

## Delivery model

All 3 phases ship in a **single pull request**, organized as **3 sequential commits** so review can be staged phase-by-phase. Commits are intentionally ordered so each is independently revertible without breaking the previous: commit 1 leaves the page functional, commit 2 adds the historical card additively, commit 3 adds the new route + small schema migration.

Run `pnpm lint && pnpm typecheck && pnpm test` between each commit, not just at the end.

## Phase 1 — Visual reset + KPI strip (Commit 1)

### Data layer
- [x] T101 Extend `getGlobalCostDashboard` return type with `kpis: DashboardKpis` and `dailyStacked: DailyStackedRow[]` in `src/types/index.ts`.
- [x] T102 Implement `getDashboardKpis(month?)` server action in `src/actions/anthropic-global.ts`. Cache tag `"anthropic-workspace-costs"`. Includes MoM math (return `null` when prior month < $1) and `projectMonthEnd()`.
- [x] T103 Implement `getDailyTotalsByWorkspace(month?)`. Reshape existing `workspaceBreakdown` into per-day stacked rows: top 8 workspaces + `Other`. **Top-8 rule (decided in spec review)**: rank by `SUM(cost_cents)` for the selected period — re-computed per render based on the month being viewed; ties broken by workspace name ASC. Same cache tag.
- [x] T104 Implement `getSyncStatus()` reading the `userId = 0` sentinel row from `anthropicSyncStatus` (per `LOCK_USER_ID` in `src/lib/anthropic-sync.ts:23`). Returns `{ lastSyncedAt, ageMinutes, isStale }` with `isStale` = age > 70 minutes.
- [x] T105 Add shared util `projectMonthEnd(mtdCents, daysElapsed, daysInMonth)` in `src/lib/utils.ts` + unit tests.
- [x] T106 Unit tests: `tests/unit/anthropic-global-kpis.test.ts` — MoM math, projection math, over-80% counting, staleness boundary.
- [ ] T107 Integration test: seed two months of workspace costs, verify `getDashboardKpis` shape.

### UI layer
- [x] T108 Rename header in `src/app/claude/page.tsx` (line 21 metadata, line 55 h1) → "Claude API Spending"; update sidebar nav label in `src/components/app-sidebar.tsx`. **Sidebar label was later renamed to "Claude Console"** in commit `331da58`.
- [x] T109 New `SyncStatusPill` component in `src/components/claude/sync-status-pill.tsx`. Green / amber / grey states per `isStale` flag. Anchored to `/settings/sync`. Later enhanced (commit `d0a5540`) to surface the hourly cron cadence ("Synced 3m ago · next in 57m").
- [x] T110 New `KpiStrip` component (`src/components/claude/kpi-strip.tsx`) — 4 tiles in `md:grid-cols-2 lg:grid-cols-4`. Tile 3 gets red ring + warning icon if `projectedMonthEndCents > orgBudget`. Tile 4 shows over-80% count out of `workspacesWithLimitCount`.
- [x] T111 Update `GlobalMetricsClient` to render `KpiStrip` above the chart. Pass through new props.
- [x] T112 Convert the daily chart in `global-metrics-client.tsx` from single-series to stacked Bar (`stackId="costs"`, one `<Bar>` per top-8 workspace + `Other`). Legend on top. Tooltip shows per-workspace breakdown. **Post-impl additions**: rank-indexed spectral palette (commit `c33d8f6`) and a "Use workspace colors" toggle persisted to `localStorage` key `claude-dashboard:useDbColors` (commit `a229d04`).
- [x] T113 Refactor `OrgCreditsPanel` → `OrgBillingBudgetCard`: drop the dead Credit Balance card; full-width; add a Projected month-end column. Move credits stub to a footnote link.
- [x] T114 Update `WorkspaceBudgetList` sort consumer + add "Hide $0 + no limit" toggle (default on, persisted to `localStorage` key `claude-hide-zero-workspaces`).
- [x] T115 Update SQL in `_getWorkspaceList` to sort: over-limit first, over-80% next, with-limit by utilization DESC, no-limit by spend DESC, $0+no-limit last.
- [x] T116 Visual restructure of `WorkspaceBudgetRow`: spend big on left, limit small on right; drill-through icon button on hover (no-op until Phase 3 ships). Drill-icon was later promoted to an always-visible `<Link>` in commit `d0a5540`, and the workspace name itself became a link in commit `e076228` — both affordances coexist.

### Verification
- [ ] T117 E2E: `tests/e2e/claude-page-phase1.spec.ts` — admin lands on `/claude`, sees new title, 4 KPI tiles, sync pill, stacked chart legend, toggle persists across reload, non-admin gets redirected.
- [x] T118 Manual: with the dev DB, confirm "Automations" appears at row 1 (over budget), KPI tile 4 is in warning color, projected tile shows the red ring.

## Phase 2 — Historical trend + sparklines (Commit 2)

### Data layer
- [x] T201 New action `getTwelveMonthTotals()` in `anthropic-global.ts`. SQL: `GROUP BY date_trunc('month', date)` for last 12 months. Returns budget cap alongside each row (uses current `anthropic_org_config` value — no history is retained, consistent with spec 018).
- [x] T202 New action `getCumulativePacing()` — window function over 4 months: `SUM(cost_cents) OVER (PARTITION BY date_trunc('month', date) ORDER BY date)`. Pivot per `dayOfMonth`. Pad missing days with `null` so Recharts skips them cleanly.
- [x] T203 New action `getTopMovers()` — top 3 by **positive** % delta only (newest 3-month vs oldest 3-month windows), with `>= $5` floor on the prior period to filter noise. **Decline / drops are filtered out** (decided in spec review — user-facing label is "Fastest growing"). Internal function/type names may stay as `getTopMovers` / `TopMover` for git history continuity.
- [x] T204 New action `getWorkspaceSparklines()` — single query: 6 months of monthly totals grouped by `(workspace_id, month)`, pivoted server-side into `Record<workspaceId, {month, totalCents}[]>`.
- [x] T205 New types in `src/types/index.ts`: `TwelveMonthRow`, `PacingRow`, `TopMover`, `WorkspaceSparkline`.
- [x] T206 Unit tests: cumulative pacing math, top-movers ranking + floor, 12-month bucketing across year boundaries.
- [ ] T207 Integration test: seed 6 months across multiple workspaces; verify sparkline shape and top movers ranking.

### UI layer
- [x] T208 New `HistoricalTrendCard` container in `src/components/claude/historical-trend-card.tsx` with a 3-way segmented control (Monthly totals / Pacing / **Fastest growing**). **Decision (post-impl)**: kept the tabbed segmented control rather than the side-by-side three-pane layout the mockup explored — segments read cleanly at desktop widths, avoid a tablet-width regression, and the three views are rarely compared simultaneously.
- [x] T209 New `TwelveMonthBarChart` (`twelve-month-bar-chart.tsx`) — Recharts BarChart + horizontal dashed budget-cap line; bars exceeding cap get a red top stroke. Polished in commit `a1138da` (greyscale ramp by month age, projected-month-end stub) and `331da58` (use `var(--destructive)` directly so the cap line actually paints on this theme).
- [x] T210 New `CumulativePacingChart` (`cumulative-pacing-chart.tsx`) — Recharts LineChart with 4 series. Current month bold; prior 3 in cool greys. Synchronized tooltip across all series. Polished in commit `a1138da` (dashed projection from latest anchor day, today marker, "tracking" footer).
- [x] T211 New `TopMoversChips` (`top-movers-chips.tsx`) — 3 chips with name + ▲ arrow + delta %. Section title is **"Fastest growing (6mo)"** (user-facing label decided in spec review). All chips render with ▲ since the action filters to positive deltas only. Phase 3 made chips navigable; commit `d0a5540` added inline `$prev → $next` transitions.
- [x] T212 New `Sparkline` primitive in `src/components/ui/sparkline.tsx`. Hand-rolled inline SVG `<polyline>` — not Recharts — to avoid 13× instance overhead. Props: `data`, `color?`, `height?`, `width?`. Renders `—` when `data.length < 2`.
- [x] T213 Add `<Sparkline>` column to `WorkspaceBudgetRow` (between spend and progress bar). Reuse `displayColor` from `anthropic_workspaces`. **Post-impl**: delta label below the sparkline is now `{N}mo` where N is the calendar-month distance between the first and last data points (commit `e076228`) — not a fixed "6mo". Movers >= +100% are highlighted.
- [x] T214 Wire all 4 new actions into `page.tsx` Promise.all and pass into the chart card + workspace list.

### Verification
- [ ] T215 E2E: navigate to `/claude`, confirm Historical Trend card renders, tabs switch views, sparkline column populated.
- [x] T216 Manual: with dev DB confirm Automations sparkline ramps up; Top Movers shows Automations + boost-starter-5 + boost-starter-3.

## Phase 3 — Drill-through (Commit 3)

### Schema migration (small, deterministic — no spike)

- [x] T301 Add Zod field: extend `orgApiKeySchema` in `src/lib/anthropic-keys.ts` (lines 5-11) to capture `workspace_id: z.string().nullable()`. Anthropic's `/v1/organizations/api_keys` already returns it — codebase currently discards it.
- [x] T302 Drizzle migration `src/lib/db/migrations/0018_messy_sleepwalker.sql`: `ALTER TABLE anthropic_sync_status ADD COLUMN resolved_workspace_id varchar(100);`. Generated via `pnpm db:generate` after updating the schema.
- [x] T303 Update `src/lib/db/schema.ts`: add `resolvedWorkspaceId: varchar("resolved_workspace_id", { length: 100 })` to the `anthropicSyncStatus` table definition.
- [x] T304 Update `resolveAllMappings()` in `src/lib/anthropic-sync.ts` (lines 143-221): when persisting `resolvedApiKeyId`, also persist the corresponding `workspace_id` from the `orgKeys` array into `resolved_workspace_id`. **Correction**: this only auto-populates for users whose mapping is *missing or changed*. Users whose `resolved_api_key_id` was already set before the column existed kept `resolved_workspace_id = NULL` indefinitely — fixed by the new `scripts/backfill-anthropic-workspace-mapping.ts` one-off (commit `67dc7d2`).
- [x] T305 Verify in dev DB: after one sync run + the backfill script, every active user's `anthropic_sync_status` row has a non-null `resolved_workspace_id` (NULL only for the org's default workspace). Verified locally: 41/41 rows updated.

### Data layer

- [x] T306 New action `getWorkspaceDetail(workspaceId | "default", month?)` in `anthropic-global.ts` returning `{ workspace, currentMonthCents, limitCents, utilizationPct, dailyTotals, topUsers, modelBreakdown }`. Cache tag `"anthropic-workspace-costs"`. Top users query joins `anthropic_usage_metrics` → `anthropic_sync_status.user_id` → `resolved_workspace_id`. Model breakdown aggregates `anthropic_usage_metrics.model` filtered by the same join.
- [x] T307 New action `getWorkspaceMonths(workspaceId | "default")` for the per-workspace month picker.
- [x] T308 Type additions in `src/types/index.ts`: `WorkspaceDetail`, `WorkspaceUser`, `ModelBreakdownRow`.
- [x] T309 Unit tests for `getWorkspaceDetail` (the `"default"` URL sentinel parser, model % math, tie-stable top-user ordering). Integration test deferred.

### UI layer

- [x] T310 New route `src/app/claude/workspaces/[workspaceId]/page.tsx` (Server Component, admin gate, parses `"default"` sentinel → `null`).
- [x] T311 New `WorkspaceDetailClient` (client wrapper) — month picker + KPI strip scoped to this workspace. **Reuses Phase 1 `KpiStrip`** with these 4 tiles (decided in spec review): (1) Total MTD · (2) MoM delta · (3) Projected month-end · (4) **Utilization %** (replaces the org-level "Over 80% count" tile). When `limitCents IS NULL`, tile 4 shows "No limit set" with an inline action calling `setWorkspaceLimit`. Post-impl polish (commit `743c612`): removed the duplicate "Over budget" badge under the month picker; the default-workspace limit editor shows a muted hint explaining the limit applies to all API usage not assigned to a named workspace.
- [x] T312 New `WorkspaceDailyChart` — single-series Recharts BarChart. Polished in commit `743c612`: `maxBarSize=56` to avoid chart-wide blobs on single-data-point workspaces, sub-dollar Y-axis formatter when daily max < $5, and a red dashed per-day budget cap `ReferenceLine` at `limit / daysInMonth`.
- [x] T313 New `WorkspaceTopUsers` — table with `User | Requests | Cost`; row click opens the user's existing profile cost page in a new tab. Footnote explains the per-user sum does not reconcile with the workspace total (different Anthropic endpoints).
- [x] T314 New `WorkspaceModelBreakdown` — horizontal stacked bar + legend table (model, tokens in/out, cost, % of workspace). Reconciliation footnote added in commit `743c612` mirroring the top-users one.
- [x] T315 Make `WorkspaceBudgetRow` a `<Link>` to the detail page. Reuse the drill icon added in Phase 1. **Implementation note**: both the chevron drill icon (commit `d0a5540` promoted it from hover-only to always-visible) *and* the workspace name itself (commit `e076228`) are now navigable.
- [x] T316 Make `TopMoversChips` navigable. Breadcrumb back uses `?workspace=` to restore the parent filter (commit `d0a5540`).

### Verification

- [ ] T317 E2E: `tests/e2e/claude-workspace-detail.spec.ts` — list → row click → detail page renders → breadcrumb back restores filter. Non-admin direct-nav redirects. 404 on bad ID.
- [x] T318 Manual smoke: walk through `/claude/workspaces/default` (URL sentinel for NULL workspace_id), a real workspace ID, and a non-existent ID.

## Phase 4 — Post-implementation refinements (out-of-band)

These tasks were not in the original T101–T318 plan but landed in this PR after reviewing the live page against the mockup. Listed here for traceability.

- [x] T401 Spec/mockup gap closures (commit `d0a5540`) — workspace filter round-trip via `?workspace=`, per-row on-pace projection, sparkline delta labels, Top Movers chip `$prev → $next`, always-visible drill chevron, sync pill cron cadence.
- [x] T402 Historical-trend chart polish (commit `a1138da`) — greyscale bar ramp + projected-month-end stub on the 12-month chart; dashed projection / today marker / "tracking" footer on the cumulative pacing chart.
- [x] T403 Spectral color order on daily chart (commit `c33d8f6`) — paint workspaces in palette order by rank instead of hash-shuffled.
- [x] T404 Daily-chart "Use workspace colors" toggle (commit `a229d04`) — switch between the curated theme palette (default) and each workspace's `display_color` from the DB. Persisted to `localStorage` key `claude-dashboard:useDbColors`.
- [x] T405 Visible budget cap + sidebar rename (commit `331da58`) — replace `hsl(var(--destructive))` with `var(--destructive)` directly so the cap line paints on this theme's oklch tokens. Sidebar entry renamed "Claude API Spending" → **"Claude Console"**.
- [x] T406 Dynamic sparkline window + linkable workspace name (commit `e076228`) — `{N}mo` label tracks actual data range; workspace name is now a `<Link>` (chevron stays).
- [x] T407 Drill-down view polish (commit `743c612`) — per-day budget cap reference line, model-breakdown reconciliation footnote, default-workspace limit-editor hint, removed duplicate "Over budget" badge, bar-width cap, sub-dollar Y-axis formatter.
- [x] T408 Per-day cost storage bug fix (commit `e1428aa`) — request `bucket_width=1d` from `/v1/organizations/cost_report`, extract `aggregateDailyCosts(buckets)` helper, key by `(workspace_id, YYYY-MM-DD)` from `bucket.starting_at`. Adds `scripts/backfill-anthropic-workspace-costs.ts`.
- [x] T409 Backfill resolved_workspace_id for pre-migration rows (commit `67dc7d2`) — `scripts/backfill-anthropic-workspace-mapping.ts`; idempotent.
- [x] T410 Simplify pass (commit `616c88c`) — batch per-day cost upserts (one statement per partial-index bucket), promote stringly-typed sentinels to module constants, flatten pacing-chart ternary.

## Cross-cutting checklist (each commit)

- [x] Cache tag `"anthropic-workspace-costs"` on every new server action so the existing hourly sync `revalidateTag` calls invalidate them.
- [x] All new types exported from `src/types/index.ts`.
- [x] `pnpm lint && pnpm typecheck` clean.
- [ ] Lighthouse mobile + desktop pass on `/claude` (Phase 1 + 2 only).
- [ ] Update `docs/admin-guide.md` (or equivalent) with screenshots after Phase 1.

## Deployment notes

When deploying this PR to production:

1. Run the standard migration: `pnpm db:migrate` (applies `0018_messy_sleepwalker.sql`).
2. After deployment, run **both** one-off backfill scripts (idempotent, safe to re-run):
   - `pnpm tsx --env-file=.env.local scripts/backfill-anthropic-workspace-costs.ts` — TRUNCATEs `anthropic_workspace_costs` and re-fetches every month with `bucket_width=1d`. Required because pre-fix rows are month-rolled to `YYYY-MM-01`.
   - `pnpm tsx --env-file=.env.local scripts/backfill-anthropic-workspace-mapping.ts` — retro-populates `resolved_workspace_id` for users whose `anthropic_sync_status` row predates migration 0018.
3. Verify in the dashboard: the per-day stacked daily chart renders distinct daily bars (not a single block on day 1), and named-workspace drill-downs surface top users / model breakdowns instead of empty tables.
