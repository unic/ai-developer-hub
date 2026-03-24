# 018-claude-global-metrics — Phase 0 Research

**Date**: 2026-03-20

---

## Finding 1: Anthropic Admin API — Workspace Endpoints

**Decision**

Use `/v1/organizations/workspaces` to sync the workspace list and `/v1/organizations/cost_report?group_by[]=workspace_id` for workspace-level daily costs.

**Rationale**

Both endpoints are confirmed available in the Anthropic Admin API. The `cost_report` endpoint returns costs in USD grouped by `workspace_id` with daily granularity (`bucket_width=1d`). `workspace_id` can be `null` for API keys that belong to the default workspace.

API key objects include a `workspace_id` field (`null` = default workspace). The existing `resolveAllMappings()` function in `anthropic-sync.ts` can be extended to also capture `workspace_id` per key without architectural changes.

**Alternatives Considered**

Using `usage_report/messages` with `group_by[]=workspace_id` is viable but returns token counts rather than pre-computed USD costs. `cost_report` is simpler for workspace-level aggregation and eliminates the need to apply pricing tables client-side.

**Impact / Notes**

No new API client surface is required beyond extending the existing Anthropic Admin API wrapper. The `workspace_id=null` case must be handled explicitly throughout the sync and storage layers (see Finding 5).

---

## Finding 2: Credit Balance — Not Available via API

**Decision**

FR-011 through FR-014 (credit balance display and budget warnings) will always render an "data unavailable" state. No API endpoint exists. The feature degrades gracefully per FR-016.

**Rationale**

The Anthropic Admin API has no `/billing`, `/credits`, or balance endpoint. This is a confirmed API gap (referenced in GitHub issue #276 on `anthropics/claude-quickstarts`). Only historical usage and cost data is available programmatically.

**Alternatives Considered**

- **Manual admin input**: Rejected during clarification (Q4 answer: Option A — no manual fallback).
- **Scraping the Console UI**: Rejected as fragile and against Anthropic's Terms of Service.

**Impact / Notes**

The P3 user story (Organization Credit Balance & Budget Warning) is partially blocked. The credit balance panel will render with a "not available via API" message. FR-011, FR-012, FR-013, and FR-014 are implemented as graceful unavailable states.

The architecture is designed so that when Anthropic exposes a credit balance API endpoint, the feature can be enabled without structural changes — only the data-fetching layer and the panel's conditional rendering need to be updated.

---

## Finding 3: Notification Badge — Server-Driven Client Island

**Decision**

A Server Component in the root layout fetches alert state via `getActiveAlerts()` and passes it as a prop to an `AlertBanner` client island rendered inside `SidebarInset`, above the main content area.

**Rationale**

Alert data refreshes hourly via cron — there is no need for SSE or real-time polling. `unstable_cache` with the tag `"alerts"` ensures fresh data after each sync. Dismiss state is stored in `localStorage` to avoid database writes for a UI-only preference. The root layout is the correct insertion point because no `(admin)` route group exists.

**ARIA pattern**: An `sr-only` `aria-live="polite"` div is announced on mount via `useEffect`. The alert banner uses `role="region"` with `aria-label` rather than `role="alert"`, which would re-announce on every client-side navigation.

**Alternatives Considered**

- **React context**: Rejected — adds a hydration boundary with no benefit given hourly data cadence.
- **Sidebar badge as primary surface**: Rejected — low contrast, difficult to make accessible.
- **SSE / WebSocket**: Rejected — data is hourly, not real-time; streaming infrastructure would be disproportionate.

**Impact / Notes**

No new data-fetching infrastructure is required. The client island is a leaf node and does not require a context provider, keeping the component tree clean.

---

## Finding 4: Workspace Sync Integration

**Decision**

Extend the existing `/api/anthropic/sync` cron route (currently scheduled every 10 minutes) to also run workspace sync when more than 50 minutes have elapsed since the last workspace sync. Staleness is tracked via an `anthropicSyncStatus` row with a sentinel `userId=-1`.

**Rationale**

The existing cron infrastructure already handles `CRON_SECRET` validation, distributed locking, and error reporting. Adding a staleness-gated workspace sync avoids a new cron endpoint while meeting the hourly freshness requirement for workspace data.

**Alternatives Considered**

A new `/api/anthropic/global-sync` cron scheduled at `0 * * * *` — simpler conceptually but consumes an additional Vercel cron slot and duplicates `CRON_SECRET` validation boilerplate. The staleness-check approach within the existing route is preferred.

**Impact / Notes**

The sentinel row (`userId=-1`) must be documented in the schema and treated as a reserved value. The 50-minute threshold (rather than 60) provides a buffer against cron jitter while still guaranteeing at least one workspace sync per hour.

---

## Finding 5: Workspace Cost Data Architecture

**Decision**

Introduce a new `anthropic_workspace_costs` table that stores daily cost per workspace sourced from `cost_report`. This is kept separate from the existing `anthropicUsageMetrics` table, which remains per-user token data.

**Rationale**

`cost_report` returns pre-computed USD costs per workspace at daily granularity — a fundamentally different data shape from per-user token data. Keeping the tables separate avoids conflating two data sources with different granularities, different originating endpoints, and different semantic meanings.

Currency handling: `cost_report` returns costs as floating-point USD. Values must be multiplied by 100 and rounded to store as integer cents, consistent with the project-wide rule that monetary values are stored as integers (cents) — never floating-point.

Default workspace: `workspace_id=null` in the Anthropic API represents the default workspace. This maps to `NULL` in the database column. The unique constraint on `(workspace_id, date)` must use `NULLS NOT DISTINCT` (PostgreSQL syntax) so that only one row per date can exist for the default workspace.

**Alternatives Considered**

Storing workspace costs in the existing `anthropicUsageMetrics` table with a special marker was considered and rejected — it would require nullable user-identity columns and pollute a per-user table with aggregate rows.

**Impact / Notes**

The `NULLS NOT DISTINCT` clause is a PostgreSQL 15+ feature and is supported by Neon. The Drizzle migration must emit this clause explicitly; standard unique index syntax does not include it by default.

---

## Open Questions

1. **Credit balance API availability**: Anthropic may eventually expose a credit balance endpoint. The current architecture is designed to accommodate this — when the endpoint becomes available, only the data-fetching function and the credit balance panel's conditional rendering need to change. No schema or infrastructure work would be required. This should be revisited when monitoring Anthropic API changelog releases.

2. **`cost_report` currency unit verification**: The `cost_report` endpoint is documented as returning costs in USD, but this should be explicitly verified in an integration test against the live API before the cents-conversion logic is merged. If a future API version changes the currency unit or scale, the stored data would be silently incorrect. The integration test should assert that a known workspace's reported cost matches a manually verified figure.
