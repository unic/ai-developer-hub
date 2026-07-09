# Spec 028 — Reports v2

Status: research / mockup phase
Created: 2026-05-19
Owner: tobias.studer@unic.com

## TL;DR

Today's `/reports` page has four tabs: **Overview**, **Trends**, **Usage**, **Forecast**. Three of them (Trends/Usage/Forecast) are thin views over the same data that answer nothing actionable. This spec proposes:

1. **Keep** Overview, but rework it around *what changed* and *where to look next*.
2. **Delete** Trends, Usage, Forecast.
3. **Add** a new **Budget** report that answers the three questions the current set can't: *what did we spend last month, where is the year going, and how does it compare to plan?*

Two HTML mockups in this folder:

- [`overview-mock.html`](overview-mock.html) — reworked Overview
- [`budget-mock.html`](budget-mock.html) — new Budget report

Open them in a browser. They're self-contained, dark-themed to match the existing app, and use realistic scenario data (FY 2026, Jan–Apr complete, mid-May).

## Why throw away three tabs?

| Tab | What it shows now | Why it can go |
|---|---|---|
| **Trends** | One line chart of billed/expected/planned over time. | No narrative, no anomaly callouts, no context. The same data is more useful inline in the new Budget view. |
| **Usage** | Horizontal bar of assigned vs available licenses + a table. | Shows utilization but doesn't connect it to **cost**. A 5% utilized tool is only worth talking about if it costs $20k/year. Belongs as a column on the Overview tool-adoption table, not its own tab. |
| **Forecast** | Three KPIs + linear projection chart. | Forecast only makes sense *next to* the budget plan it's deviating from. Now lives inside the Budget report. |

The data and helpers stay (`getBilledCostsTimeSeries`, `getBudgetForecast`, `getLicenseUtilizationByTool`) — they're consumed by the two surviving reports, not surfaced as their own tabs.

## Proposed structure

### Overview (reworked)

Top-down, hierarchy of "what's going on":

1. **KPI strip** — active users / tools / licenses / expected monthly spend with **MoM deltas** and a sparkline. (Today it shows raw numbers with no comparison.)
2. **Budget health hero** — single big card: status pill (on-track / at-risk), one-sentence narrative, "Open Budget report →" CTA. This replaces the cramped "Billed YTD / Budget remaining" mini-cards from today.
3. **What changed this month** — 4 auto-generated insight cards highlighting MoM movers (new seats, usage spikes, off-boarding). The "narrative" today's overview is missing.
4. **Tool adoption** — same table as today, plus rank-shift markers, MoM delta column, % of org spend, and a share bar. Folds in what the deleted Usage tab tried to do.
5. **Spend by circle** — current Circle Report, plus a stacked share bar showing tool mix per circle and an MoM delta.

### Budget (new)

Answers the three questions in order:

1. **At-a-glance hero** — annual ceiling, billed YTD, run-rate, projected year-end. Single multi-marker progress bar showing all four values at once + status pill.
2. **Past-month spotlight** — full focus on April (most recent completed month):
   - Planned / Actual / Variance % KPI tiles
   - Inline plan-vs-actual bar visual
   - Top 5 variance drivers (per-tool waterfall)
   - "Why the overage" callout explaining the drivers
3. **Plan vs actual** — grouped bar chart Jan→Dec showing planned, billed (color-coded under/over), and forecast for remaining months. Annotated with best/worst months and slope.
4. **Forecast** — cumulative line chart with actual (solid), forecast (dashed + confidence band), and annual-ceiling reference line. Includes "crosses ceiling on X" annotation and a recommended-actions callout.
5. **Per-tool breakdown table** — YTD spent vs YTD planned, projected year-end vs annual cap, pace progress bar, status chip.

## Data sources — nothing new required for the bulk of it

All existing schema and aggregations cover the proposal. Confirmed via the worktree exploration:

| Block | Data source | Already exists? |
|---|---|---|
| Annual ceiling, monthly plan | `annual_budgets`, `budget_periods` | ✅ |
| Billed YTD, past-month actuals | `billed_costs` joined by `period_id` | ✅ via `getBilledCostsTimeSeries` |
| Per-tool expected monthly | `license_assignments` × `access_tiers.monthly_cost_cents` | ✅ via `getPerToolSpend` |
| Forecast year-end | OLS linear regression on completed periods | ✅ via `getBudgetForecast` |
| Claude API costs | `anthropic_workspace_costs`, `anthropic_usage_metrics` | ✅ |
| Copilot costs | `copilot_billing_snapshots` | ✅ |
| MoM deltas on assignments | snapshot active assignments as of last month-end vs today | ⚠️ needs a small helper, no schema change |
| Per-tool budget allocation | derived from each tool's expected monthly × 12 | ✅ derived |

The only **new** computation worth flagging: the per-tool **YTD planned** allocation. Today's `budget_periods.planned_amount_cents` is org-wide, not per tool. The mock shows it derived from `access_tiers.monthly_cost_cents × max_licenses × period count` — that's a reasonable derivation, but worth a product decision before implementation (is the planned amount really "12 × current monthly run-rate" or should budgets be set per-tool?).

### D-2 decided (2026-05-19): adopt the budget detail page's billed + running pattern

The Budget report uses the same Actual formula already in use on `/budget/[id]`:

```
actualCents = billedTotalCents + runningCostCents
```

where `runningCostCents` comes from `getRunningCostsForPeriod(periodId)` (live Anthropic API usage from `anthropic_workspace_costs`). Every Actual value in the report — KPI tiles, chart bars, forecast input, per-tool table — uses this. **Both billed and running are required in v1**; they're not separate cards or follow-ups. See [`gaps.html`](gaps.html#decisions) (D-2) and [`plan.html`](plan.html#phase-3) §3.1, §3.5 for details.

## Open questions for product

1. **Per-tool budgets** — do we want explicit per-tool budgets (new schema), or stick with derived-from-licenses as the mock shows?
2. **Forecast method** — linear is fine for now, but should we surface "what changes if I cap tool X at N seats?" scenario modeling? (Punt to a v2 if so.)
3. **Past-month definition** — when a month just ended, we want it to be the spotlight. But when do we switch? Day 1 of new month, or wait until invoices arrive (usually mid-month)? Mock assumes "last calendar month that has reconciled invoices".
4. **Empty states** — what if no active budget exists? Mock doesn't cover this; current reports page hides budget cards entirely (`if (activeBudget) ...`). New Budget tab would show an onboarding empty state ("Create a budget to see this report").

## What the mockups *don't* try to be

- **Final visual design.** Visual style mirrors `specs/026-claude-page-redesign/mockup.html` (dark, lime accent, shadcn-ish) so they feel native to the codebase. The shipped UI uses real shadcn/ui + Recharts.
- **Pixel-perfect.** SVG charts are inlined for portability — production uses Recharts via the existing `ChartContainer`.
- **An implementation plan.** No tasks, no migration plan, no acceptance criteria yet — that's a `plan.md` / `tasks.md` follow-up if this direction lands.

## Next steps if this direction is approved

1. Formalize the requirements into a `spec.md`.
2. Decide on the per-tool budget question above.
3. Write a `plan.md` to scope migrations (likely zero or one column added) and the new server actions.
4. Break the plan into an implementation task list — expected to be a single PR since the deletion-of-tabs work is trivial and the Budget tab reuses existing aggregations.
