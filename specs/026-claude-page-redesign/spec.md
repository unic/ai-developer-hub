# Spec 026: Claude API Spending page redesign

**Status**: Ready for implementation
**Created**: 2026-05-15
**Owner**: tobias.studer@unic.com
**Replaces / supersedes**: 018-claude-global-metrics (UX layer only; data layer is unchanged)

## Summary

Redesign the admin `/claude` page so it surfaces operational signal (over-budget workspaces, run-rate, growth trends) instead of just current totals. The redesign keeps the existing schema (no migrations in Phases 1 & 2) and reuses the hourly sync established by spec 018.

## Why now

With real data — 13 workspaces, "Automations" at 105% of its $50 cap and 4.3x growth over six months — the current layout buries the operational signal:

- The total dollars-spent number is the largest element, but it is the *least actionable* signal on the page.
- The daily chart is a single series so it cannot answer "which workspace drove the spike on May 12".
- The workspace list is sorted alphabetically; the over-budget workspace is buried.
- The Credit Balance card is a permanent placeholder ("not exposed by the Anthropic API") consuming 50% of the Org Billing row.
- There is no historical view, no run-rate forecast, no MoM comparison, and no drill-through into a single workspace.

A 5-minute review with the live page made these gaps obvious and they are addressed phase-by-phase below.

## Scope (3 phases delivered in 1 PR)

All three phases ship in a **single pull request**, organized as three sequential commits so review can still be staged phase-by-phase. The user→workspace mapping decision for Phase 3 (see `data-model.md`) is small enough — a single nullable column on `anthropic_sync_status` plus a Zod schema extension — that there's no spike risk justifying separate PRs.

- **Phase 1 (commit 1) — Visual reset + KPI strip.** Rename, KPI tiles, stacked daily chart, full-width billing card, sync pill, workspace list re-sort + Hide $0 toggle. Sidebar entry was subsequently renamed from "Claude API Spending" to **"Claude Console"** (commit `331da58`).
- **Phase 2 (commit 2) — Historical detail.** 12-month bar chart, cumulative pacing chart, Top Movers chips, per-row sparklines. Sparkline delta label is **dynamic** (`{N}mo` where N = calendar-month distance between first and last data points), not a fixed "6mo".
- **Phase 3 (commit 3) — Drill-through.** `/claude/workspaces/[id]` with per-workspace daily chart, top users (attributed via Anthropic-provided `workspace_id` on each API key), model breakdown.

### Post-implementation refinements

Beyond the three phases, several polish commits landed in this PR:

- **Per-day cost storage bug fix** (commits `e1428aa`, `616c88c`) — `anthropic_workspace_costs` previously held month-rolled rows keyed to `YYYY-MM-01` because `/v1/organizations/cost_report` was called without `bucket_width=1d` and the aggregation loop discarded `bucket.starting_at`. Phase 1 / Phase 2 charts implicitly assumed per-day storage; the fix makes that real. Two batched upserts (one per partial-index bucket) replace the original per-row round-trip.
- **Historical-trend card kept the tabs**, not the side-by-side layout the mockup explored. Rationale: the segmented control reads cleanly at desktop widths, avoided a layout regression on tablet, and the three views are rarely compared simultaneously in practice.
- **Daily-chart color toggle** — a "Use workspace colors" switch in the daily spend card header flips between the curated theme palette (default) and each workspace's `display_color` from `anthropic_workspaces`. Persisted to `localStorage` (`claude-dashboard:useDbColors`). Default switched to the palette because Anthropic-supplied `display_color` values frequently collide across `boost-starter-*` and `boost-expert-*` families.
- **Workspace name is a Link** to the drill-through detail page; the chevron drill-icon stays as the original affordance.
- **Drill-down polish** (commit `743c612`): per-day budget cap reference line on the workspace daily chart, model-breakdown reconciliation footnote mirroring the top-users footnote, default-workspace limit-editor hint, removed duplicate "Over budget" badge under the month picker.
- **Backfill scripts**: `scripts/backfill-anthropic-workspace-costs.ts` (truncate + re-fetch after the daily-bucket fix) and `scripts/backfill-anthropic-workspace-mapping.ts` (one-off retro-population of `resolved_workspace_id` for users whose mapping existed before migration 0018).

## Out of scope

- Anthropic credit balance display (still not exposed by the Anthropic API).
- Workspace-level alerts beyond the existing site-wide banner.
- Changes to the per-user `/profile` Claude cost view.
- Backfill of historical *usage* data — relies on what spec 025 already populated. (Note: a one-off `anthropic_workspace_costs` backfill *did* become necessary because of the per-day storage bug — see "Post-implementation refinements" above.)

## Companion artifacts

- `plan.html` — full technical implementation plan with embedded visualizations (this is the primary plan document; open in a browser).
- `mockup.html` — standalone interactive mockup of the redesigned page.
- `tasks.md` — ordered execution checklist (single PR; 3 commit groups).
- `data-model.md` — schema analysis and the user→workspace mapping decision for Phase 3.
- Background: `C:\Users\stude\.claude\plans\claude-page-analysis.md` (analysis that informed this spec).
