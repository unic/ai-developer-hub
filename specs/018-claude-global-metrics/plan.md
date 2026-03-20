# Implementation Plan: Global Claude Console Metrics & Budget Monitoring

**Branch**: `018-claude-global-metrics` | **Merged**: 2026-03-20 | **Spec**: [spec.md](./spec.md) | **Status**: ✅ Merged to main
**Input**: Feature specification from `/specs/018-claude-global-metrics/spec.md`

## Summary

Extend the existing per-user Claude API cost tracking to add an admin-only global dashboard showing org-wide costs filterable by workspace and API key, workspace-level budget limits with proactive in-app alerts, and org-level billing budget monitoring. Four new DB tables store workspace metadata, daily workspace costs, admin-configured workspace spending limits, and a singleton org config holding the manually entered billing budget limit (Anthropic API does not expose this programmatically). Org credit balance remains unavailable via API and shows a graceful "unavailable" state. The hourly sync is added to the existing cron infrastructure via a staleness-gated extension.

## Implementation Notes (As Built)

Key deviations and decisions made during implementation:

### API Data Format
The Anthropic `cost_report` API returns `amount` already in **fractional cents** (not USD dollars). e.g., `"522.584295"` = ~$5.23. Conversion is `Math.round(parseFloat(amount))` — **no `* 100` multiplication**. This was discovered during debugging and is contrary to the original T009 assumption ("Convert USD float to cents via `Math.round(usd * 100)`").

### Workspace Filter Resets on Month Change
T019/T033 originally specified that the workspace filter should persist across month changes (showing $0.00 for workspaces with no data in the new month). The implemented decision **resets the workspace filter to "All workspaces"** on month change to prevent stale/invalid Select state. The workspaceBreakdown only includes workspaces that have cost data for the selected month.

### Raw SQL Upserts (Drizzle Partial Index Bug)
T009/T021 originally used Drizzle's `onConflictDoUpdate` for partial-index upserts. In production this caused a 30× overcount bug (Drizzle generates incorrect WHERE clauses for partial-index ON CONFLICT). Switched to **raw SQL upserts** via `db.execute(sql\`INSERT ... ON CONFLICT ... WHERE ... DO UPDATE ...\`)`. Batched to a single INSERT per workspace type (named vs. default) using `sql.join()`.

### New Cron Endpoint (not extension of existing)
T012 planned to extend `src/app/api/anthropic/sync/route.ts` with a fire-and-forget workspace sync call. Instead, a **dedicated cron endpoint** was created at `src/app/api/anthropic/workspace-sync/route.ts` (T011), and the vercel.json cron entry points to it directly. The existing per-user sync route was not modified.

### Custom Progress Bars (not shadcn `<Progress>`)
T022/T030/T042 specified shadcn `<Progress>` components with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. The implementation uses **custom div-based progress bars** (consistent with workspace-budget-list.tsx style). ARIA attributes are on the wrapping elements.

### API Key Filtering Not Implemented
T017 mentioned workspace and API key filtering in the chart. Only **workspace filtering** was implemented. API key filtering was omitted as out of scope.

### Sync Button Added to Page Header
A `<SyncButton>` component (`src/components/claude/sync-button.tsx`) was added to the main `/claude` page header, allowing admins to trigger a manual sync from the UI (in addition to the cron). Not in the original task list.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, NextAuth 5.0.0-beta.30, Recharts 2.15.4, shadcn/ui (new-york), Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: Neon PostgreSQL serverless via `@neondatabase/serverless` — 4 new tables, 1 modified table
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Vercel (Node.js runtime) + Neon PostgreSQL
**Performance Goals**: SC-001 (3s page load), SC-002 (1s workspace/API key filter — client-side), Constitution III (LCP < 2.5s, INP < 200ms)
**Constraints**: `ANTHROPIC_ADMIN_API_KEY` required; admin-only routes; `CRON_SECRET` for cron endpoint; credit balance not available via Anthropic API (graceful degradation)
**Scale/Scope**: ~10–100 workspaces typical; daily cost rows per workspace; hourly data freshness

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | ✅ Pass | All new code TypeScript strict. New server actions follow existing `{ success, data } \| { success, error }` pattern. New DB tables typed via Drizzle schema. |
| II. UX Consistency | ✅ Pass | AlertBanner uses existing `shadcn/ui Alert` component. Progress indicators use `shadcn/ui Progress`. Global metrics page follows existing admin page layout patterns. No ad-hoc styling. |
| III. Performance Budgets | ✅ Pass | Global metrics page uses Server Components for initial data fetch. Recharts already in bundle. Workspace/API key filtering is client-side (instant, SC-002 < 1s). `unstable_cache` on `getActiveAlerts()` prevents redundant DB reads in layout. |
| IV. Accessibility-First | ✅ Pass | AlertBanner uses `sr-only aria-live="polite"` announced once on mount via `useEffect`. Persistent alert uses `role="region"` + `aria-label` (not `role="alert"` to avoid re-announcing on navigation). Progress bars use `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. Dismiss button is keyboard-focusable with `aria-label`. |
| V. Simplicity & Maintainability | ✅ Pass | Workspace sync extends existing cron route via staleness check — no new cron endpoint. AlertBanner is a single ~80-line client island. No new state management library. `getOrgCreditsStatus()` returns stable "unavailable" interface ready for future Anthropic API update. |

**Complexity Tracking**: No violations — table not needed.

**Post-Phase 1 re-check**: ✅ Data model uses simple new tables with no FKs between them (independent sync sources). Contracts follow existing server action patterns. No premature abstractions.

## Project Structure

### Documentation (this feature)

```text
specs/018-claude-global-metrics/
├── plan.md              # This file
├── research.md          # Phase 0 output ✅
├── data-model.md        # Phase 1 output ✅
├── quickstart.md        # Phase 1 output ✅
├── contracts/
│   └── server-actions.md  # Phase 1 output ✅
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── api/
│   │   └── anthropic/
│   │       └── sync/
│   │           └── route.ts           # Modified: add staleness-gated workspace sync
│   └── claude/
│       └── page.tsx                   # New: admin-only Global Claude Metrics page (Server Component)
├── components/
│   ├── alert-banner.tsx               # New: client island — threshold breach banner in root layout
│   └── claude/
│       ├── global-metrics-client.tsx  # New: client wrapper with workspace/API key filters + chart
│       ├── workspace-budget-list.tsx  # New: workspace budget cards with progress indicators
│       └── org-credits-panel.tsx      # New: org credit balance panel (shows "unavailable")
├── actions/
│   ├── alerts.ts                      # New: getActiveAlerts() with unstable_cache tag "alerts"
│   └── anthropic-global.ts            # New: getGlobalCostDashboard, getWorkspaceList,
│                                      #      setWorkspaceLimit, setOrgBillingBudget,
│                                      #      syncAnthropicWorkspaces, getOrgCreditsStatus
└── lib/
    ├── db/
    │   └── schema.ts                  # Modified: 3 new tables + 1 new column
    └── anthropic-workspace-sync.ts    # New: workspace list + cost_report sync logic
```

**Modified files:**
```text
src/app/layout.tsx                     # Add getActiveAlerts() fetch + <AlertBanner> render
src/app/api/anthropic/sync/route.ts   # Add staleness-gated workspace sync call
src/components/app-sidebar.tsx         # Add "Claude" nav item (admin-only)
src/lib/db/schema.ts                   # 3 new tables, workspaceSyncCompletedAt column
```

**Structure Decision**: Single Next.js project (existing structure). New route at `/claude` for global metrics. All new logic in `src/actions/`, `src/lib/`, and `src/components/claude/`. Minimal modifications to existing files.
