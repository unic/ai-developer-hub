# Spec 027: Claude Console — Users sub-page

**Status**: Proposed
**Created**: 2026-05-18
**Owner**: tobias.studer@unic.com
**Builds on**: 026-claude-page-redesign (which introduced the Claude Console hub and the workspace drill-through)

## Summary

Add a second sub-page to the Claude Console that re-pivots the same Anthropic data from **workspaces** to **users**. The existing redesigned `/claude` page becomes the "Workspaces" tab; the new `/claude/users` page becomes the "Users" tab. Both share the same header, sync pill, and month picker, so the only thing that flips when switching tabs is the unit of analysis.

The goal is to answer a new set of operational questions that the workspace-centric view buries:

- **Who is the most expensive user this month?** Currently you have to click into the right workspace, scan the top-users panel, and remember to repeat that for every workspace.
- **Is cost concentrated in a few power users, or spread across the team?** No view answers this today.
- **Which users are growing fastest?** The workspace-level "Fastest growing" chip does not surface user-level growth.
- **Which provisioned users have never actually used Claude?** Today you have to cross-reference the license list and per-user profile cost by hand.

## Why now

Spec 026 landed the workspace pivot, the hourly sync, and the user→workspace mapping that makes per-user attribution real (`anthropic_sync_status.resolved_workspace_id`). Everything required to render a users overview is already in the database. With 41 active users + 13 workspaces in production, the workspace tab now scales for the workspace audience but a single answer like "show me the top 10 users across the whole org" still requires manual aggregation.

## Scope (3 phases delivered in 1 PR)

Like spec 026, all three phases ship in **a single pull request** organized as three sequential commits so review can be staged phase-by-phase. The new schema work is small (one nullable column on `users` is *not* needed — everything joins through existing tables) so there is no spike risk justifying separate PRs.

- **Phase 1 (commit 1) — Sub-page nav + Users MVP.** Tabbed nav on `/claude`, new `/claude/users` route, KPI strip (4 tiles), Top 10 users horizontal bar chart, Users table (TanStack) with sort/search/filter, row drill-through to existing `/profile?userId=N`.
- **Phase 2 (commit 2) — Distribution + sparklines + Top movers.** Cost distribution histogram, Fastest growing users (6mo) chips, per-row 6-month sparklines, and a Daily spend by user (top 5 stacked) chart that mirrors the workspace chart on `/claude`.
- **Phase 3 (commit 3) — Per-user drill-through.** New route `/claude/users/[userId]` that mirrors the workspace drill page: per-day chart with budget reference line, model breakdown, 12-month bar chart, top dates. Replaces the existing `target="_blank"` link to `/profile` from the workspace top-users table.

### Out-of-band polish anticipated

The same pattern as spec 026 will likely apply — expect a polish phase to follow once the page is live with real data. Likely candidates already visible from the data model:

- A "users without API key" affordance that links straight to the user import flow.
- A workspace filter chip on the Users tab that round-trips with `/claude` via `?workspace=`.
- A toggle to switch the Top 10 chart between cost and tokens.

These are explicitly *not* in scope for the initial PR.

## Out of scope

- Schema changes. The page is pure UI + aggregation over existing tables. The user→workspace mapping (`anthropic_sync_status.resolved_workspace_id`) and the per-user-per-day-per-model grain in `anthropic_usage_metrics` are both already shipped by spec 026 and earlier work.
- Per-user budget limits. Anthropic does not expose per-user caps via the Admin API, and we have no precedent for org-side enforcement on individual users. If the data tells us we need them, that is a future spec.
- Backfill. All data the page reads already exists from the hourly sync established in spec 018.
- Replacing the existing `/profile` page. The user-facing profile cost view stays as the per-user self-service surface; `/claude/users/[userId]` is the *admin* surface and shows a superset of the same data with admin-only context (workspace assignment, MoM trend, projected month-end).

## Companion artifacts

- `plan.html` — full technical implementation plan with embedded visualizations (this is the primary plan document; open in a browser).
- `mockup.html` — standalone interactive mockup of the new Users sub-page.
- `tasks.md` — ordered execution checklist (single PR; 3 commit groups).
- `data-model.md` — schema analysis (no migrations; documents the existing join path so future contributors do not re-derive it).
- Sibling spec: `specs/026-claude-page-redesign/` for the workspace pivot this builds on.
