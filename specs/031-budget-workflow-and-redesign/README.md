# Spec 031 — Budget Workflow & Detail Redesign

Status: research / mockup phase
Created: 2026-05-21
Owner: tobias.studer@unic.com

## TL;DR

Sidebar "Budget" should land directly on the current fiscal year's detail view, not a summary card that requires a second "View Details" click. The all-budgets list moves to `/budget/history`. The detail view itself gets a visual redesign — see [`detail-mock.html`](detail-mock.html).

## The workflow problem

Today, `src/app/budget/page.tsx` (lines 86–155) renders a Card summarising the active FY with six KPI tiles and a "View Details" button that links to `/budget/[activeBudget.id]`. The detail page (`src/app/budget/[id]/page.tsx`) re-fetches and re-renders the same totals with more depth. 95% of admin visits to "Budget" want the current year — they pay one extra click and a full second page render to get there. The "All Budgets" card below (line 169, only shown when `allBudgets.length > 1`) is the only thing the index page provides that the detail view doesn't, and it's the rarer use case.

## Proposed workflow

Sidebar "Budget" → `/budget` resolves to the **current active budget detail view**. No intermediate summary card, no second click.

**Recommendation: fold, don't redirect.** Replace the contents of `src/app/budget/page.tsx` with the detail-view rendering, fetching `getActiveBudget()` and treating the result as the page's primary data. Keep `src/app/budget/[id]/page.tsx` as the route for *specific* (typically past / archived) budgets reached from history. The redirect alternative — `redirect('/budget/' + activeBudgetId)` from the index — is cleaner URL-wise but adds a server round-trip on every sidebar click and creates a non-deterministic "what is /budget?" answer. Folding pays for itself by making the landing instant; the duplication is one shared client component (`BudgetDetailClient`) imported from both routes, not two implementations.

The all-budgets list (currently the second Card on `/budget`) moves to **`/budget/history`**. "History" is preferred over "all" because it signals *past + archived* — the active budget is right there on `/budget`, not on the list page. Surface it from the detail view in two places:

- A small `All budgets →` link in the page header next to the FY title.
- A breadcrumb row above the H1: `Budget / FY 2026` where `Budget` deep-links to `/budget/history`.

The "New Budget" button stays on the detail view header (admin-only, already gated).

**Edge case — no active budget exists:** `/budget` renders an empty state with two CTAs: "Create Annual Budget" (admin-only) and "View past budgets →" pointing at `/budget/history`. Without the second link, an admin landing on an empty `/budget` would have no way to discover that archived budgets exist.

### New URL structure

```text
/budget               → active FY detail view (was: summary card + View Details)
/budget/history       → all budgets table (was: bottom Card on /budget)
/budget/[id]          → a specific (past/archived) budget detail view (unchanged route, same client)
/budget/new           → create-budget form (unchanged)
```

## Visual redesign of the detail view

See [`detail-mock.html`](detail-mock.html) for the proposed visual treatment (dark-themed, matches the codebase styling from 028/029). The redesign is **visual only** — every server action, dialog, allocation editor, and CRUD path in `BudgetDetailClient` (`src/app/budget/[id]/budget-detail-client.tsx`) keeps its current behaviour. What's changing:

- **Replace the five flat KPI cards** (lines 271–316: Total Budget / Allocated / Expected / Actual / Variance) with a single **budget-health hero**: planned, expected, and actual rendered as overlaid markers on one multi-segment progress bar against the annual ceiling, plus a status pill (on-track / at-risk / over-budget) and a one-sentence narrative ("Tracking $14k under expected as of mid-May").
- **Collapse the conceptual overlap** of `Total Budget` / `Allocated` / `Unallocated` — the same number expressed three ways. Surface "Unallocated $X remaining" as a small annotation under the hero progress bar, not its own card.
- **Highlight the current month** in the periods table (line 338 onwards). Today there's no visual cue that "May" is *now* — all 12 rows look identical until one happens to be `bg-destructive/10`.
- **Strengthen the over-budget signal.** `bg-destructive/10` is the only cue today (line 359) — easy to miss against the muted table background. Add a left-edge accent bar plus a status chip in the variance column.
- **Keep the expandable period rows** (billed-cost line items + Anthropic API running breakdown) — they're the most useful part of the current page. Just style the indent and the "Anthropic API (running)" callout consistently with the new palette.

What's **not** changing: the add/edit/delete billed-cost dialogs, allocation save flow, the `runningCosts` data shape, archived-budget read-only behaviour, or any server action.

## Today vs proposed

| Area | Today | Proposed | Why |
|---|---|---|---|
| Landing page | `/budget` shows a summary Card + "View Details" button | `/budget` renders the active FY detail view directly | One click less for the common case; the summary card duplicated data already on the detail page |
| All-budgets list | Second Card on `/budget`, only visible when >1 budget exists | Dedicated `/budget/history` page, reachable from header + breadcrumb | Frees the landing page for the active budget; discoverable regardless of count |
| KPI strip | 5 (detail) / 6 (index) flat tiles, conceptually overlapping | One budget-health hero with multi-marker progress bar, status pill, narrative | Tells the user the answer ("on track / not on track") in one glance; current tiles require mental arithmetic |
| Period highlighting | Single `bg-destructive/10` row tint when over budget | Current-month accent + stronger over-budget signal (left-edge bar + variance chip) | "When is now?" and "what's broken?" should be answerable in <1 second |

## Out of scope

- Data model: no schema changes. All redesign uses existing `annual_budgets`, `budget_periods`, `billed_costs`, `anthropic_workspace_costs`.
- Server actions: `getActiveBudget`, `getBudgets`, `getBudgetWithCosts`, `getPerToolSpend`, `getRunningCostsForPeriod`, `updateBudgetAllocations`, `createBilledCost`, `updateBilledCost`, `deleteBilledCost` — all unchanged.
- Validation, the new-budget creation flow (`/budget/new`), and the budget edit/archive actions in `BudgetListActions`.
- The Reports → Budget tab — that's spec 028 and lives at `/reports`.
- Per-tool spending breakdown — removed from the detail view entirely. It's already covered by the Reports → Budget page (spec 028); duplicating it here was noise.
- Per-tool budgets (still derived from `expected_spend_cents`; spec 028 open question still applies but is not blocked by this).

## Implementation sketch

- `src/app/budget/page.tsx` — replace the index rendering with the same logic currently in `src/app/budget/[id]/page.tsx`, sourced from `getActiveBudget()`. Empty state gets a "View past budgets →" link to `/budget/history`.
- `src/app/budget/[id]/page.tsx` — unchanged route handler; keeps serving specific budgets reached from history. The client component is shared.
- `src/app/budget/[id]/budget-detail-client.tsx` — refactor into composable sections: `BudgetHealthHero`, `PeriodAllocationsTable`. Each takes the same props it computes from today. Dialogs (`AddBilledCostDialog`, `EditBilledCostDialog`, `DeleteBilledCostDialog`) extracted into siblings to keep the parent under 300 lines.
- `src/app/budget/history/page.tsx` — new server component. Renders an `<h1>Budget History</h1>` + the existing `BudgetTable` from `src/app/budget/budget-table.tsx`. Reuses `getBudgets()`.
- `src/app/budget/budget-table.tsx` — unchanged.
- `src/components/app-sidebar.tsx` line 55 — unchanged (`Budget` still points at `/budget`).
- Breadcrumb component — either use a shared `<Breadcrumbs />` if one exists, or inline a two-segment `<nav>` in the detail view header. Check `src/components/ui/breadcrumb.tsx` (shadcn ships one) before adding anything new.
- Delete: nothing. The summary-card branch in `src/app/budget/page.tsx` is replaced, not preserved.

## Next steps

- Land [`detail-mock.html`](detail-mock.html) (sibling task) and review the visual treatment against the live page.
- Run `/speckit.specify` to formalise this into a `spec.md` once direction is approved.
- Single PR is realistic: route move + redesign together, since the detail-client refactor touches both.
