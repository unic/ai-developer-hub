# Budget Extensions — Feature Concept

**Status:** Exploration / concept
**Author:** drafted 2026-05-22
**Related worktree branch:** `budget-extensions`

---

## 1. Problem

The annual budget is a single ceiling per fiscal year (`annual_budgets.totalAmountCents`). When mid-year reality changes — a new tool we didn't plan for (e.g. Claude API for engineering), an unexpected seat-count increase, a vendor price bump — the only way to absorb it today is to call `updateBudgetTotal()` and bump the ceiling. That mutation is logged in `change_history` as a generic `updated` row with an old/new number and nothing else.

What we lose:

- **Why** the ceiling moved — no reason, justification, or category.
- **Attribution** — extensions for "new Claude tool" and "vendor price increase" look identical in history.
- **Baseline vs. extended** — the original plan disappears. We can no longer answer "how much did we extend the budget this year?" without diffing history rows.
- **Visibility** — the dashboard, budget detail hero, and reports just show a larger number; nothing signals that the number was extended after the plan was approved.

## 2. Proposed model

Introduce a first-class **`budget_extensions`** entity. Each row is an additive delta to the annual ceiling with a documented reason and (optional) attribution to a tool.

```text
budget_extensions
  id                   serial pk
  budget_id            int     fk → annual_budgets.id (cascade delete)
  amount_cents         int     not null            -- positive = extension, negative = reduction
  reason               varchar(120) not null       -- short title, e.g. "Add Claude API for engineering"
  description          text                        -- longer justification
  category             enum(                       -- new enum budget_extension_category
                          'new_tool',
                          'scope_increase',
                          'seat_increase',
                          'vendor_price_increase',
                          'reallocation',
                          'other'
                       ) not null
  linked_tool_id       int     fk → ai_tools.id    -- optional
  effective_date       date    not null            -- defaults to today
  created_by           int     fk → users.id
  created_at           timestamp not null
  updated_at           timestamp not null
```

**Derivation rule:**

```text
effectiveCeiling(budget) = budget.totalAmountCents + Σ extension.amountCents
```

`annual_budgets.totalAmountCents` keeps its current meaning as the **original baseline** — the number set at budget creation. The effective ceiling is computed. This keeps the "what did we plan" vs "what did we end up at" question answerable forever.

> Alternative considered: store an `original_amount_cents` column and keep `totalAmountCents` as the live effective total. Rejected because it forces every existing read site to switch which column it reads; the proposed model leaves the existing column meaningful and adds derivation on top.

**Migration of existing data:** trivial. `totalAmountCents` is already the original for any budget that has never been touched. Budgets that were already extended via `updateBudgetTotal()` keep their current value as the "baseline" — historical fidelity is lost for those, but going forward all extensions are tracked.

**Validators (`src/lib/validators.ts`):**

```ts
budgetExtensionSchema = {
  budgetId: number positive,
  amountCents: number int (non-zero),
  reason: string min 3 max 120,
  description: string optional max 2000,
  category: enum,
  linkedToolId: number positive optional,
  effectiveDate: date,
}
```

**Server actions (`src/actions/budget-extensions.ts`):**

- `createBudgetExtension(input)` — insert row, record in `change_history` with `entityType="budget_extension"`.
- `updateBudgetExtension(input)` — edit reason/description/category/linkedTool/effectiveDate only. Amount edits go through a new extension (audit-clean).
- `deleteBudgetExtension(id)` — only allowed if budget is still `active`. Snapshot full row into change history.
- `getBudgetExtensions(budgetId)` — list ordered by `effectiveDate desc`.

## 3. Allocation behavior

When an extension is created, the dialog asks **how to allocate** the delta across periods. Four options:

1. **Leave unallocated** — the ceiling rises; planned-YTD numbers don't move. Existing "unallocated" tile in the hero surfaces the headroom.
2. **Distribute across remaining periods** — split evenly across periods whose `endDate >= effectiveDate`.
3. **Add to a single period** — pick one period (useful for one-off costs).
4. **Distribute custom** — opens the existing allocation editor pre-loaded with the delta.

Allocation is a separate concern from the extension record. The extension is the audit trail; the allocation update is just a regular `updateBudgetAllocations` call. Both are wrapped in a single transaction in `createBudgetExtension`.

## 4. Where it surfaces in the UI

| Surface | Today | With extensions |
|---|---|---|
| Budget detail hero | "Annual ceiling: €50,000" | "Annual ceiling: €60,000" + small tag `€50k baseline + €10k extended` linking to the extensions list |
| Budget detail page | No extension section | New "Budget extensions" card listing each extension with reason, category badge, linked tool, amount, who/when. Admin: "Add extension" CTA |
| Period allocation table | Planned column shows current planned | When a period has been bumped by an extension, sub-label under planned: `+€2,500 from extension` |
| Dashboard budget hero | Just the ceiling | Adds a subtle "extended +€10k" inline tag |
| Reports → Budget Report | Forecast chart vs ceiling | Optional dashed line at the original baseline; main ceiling line uses the effective number |
| Budget history page | Lists archived/active budgets | Adds an "Extensions" count column |
| Change history feed | One row per total bump | Extension creates a structured row (entity = `budget_extension`); allocation distribution shows as separate `budget_period` updates |

## 5. Workflow

For this app's user base (one or a few admins, no separate approver) the workflow is just **direct create** — no `pending`/`approved` states. The schema deliberately omits a status enum to keep things simple; if a multi-stakeholder approval workflow is ever needed it can be added later without a destructive migration.

Permission model: extension create/edit/delete restricted to `role = admin`, same gate as the budget itself. Read access matches existing budget read access (admin + finance roles, per current `AuthGuard` rules).

## 6. Edge cases & rules

- **Archived budgets are immutable** — same rule as today. Cannot add/edit/delete extensions once `budget.status = "archived"`. Past extensions stay visible (read-only).
- **Negative extensions** — allowed (a "reduction"). UI shows them with destructive badge. Same audit trail.
- **Effective date in the past** — allowed; doesn't move period boundaries. Some admins backfill the documentation of a bump that was already made.
- **Effective date after fiscal year end** — disallowed.
- **Reducing below current commitments** — if `effectiveCeiling < totalAllocations`, block save and show "would over-allocate by €X" — same guard as `updateBudgetTotal`.
- **Linked tool optional** — not all extensions map to a tool (e.g. "seat increase across portfolio"). Category is mandatory; tool link is the fine-grained attribution.

## 7. Open questions

- Should `updateBudgetTotal()` be deprecated in favor of "create extension"? Recommendation: **yes**, eventually. Phase 1 keeps both working. Phase 2 the budget edit dialog only offers "add extension" and the raw total edit is removed from the UI. Existing API stays.
- Should the dashboard be louder about extensions (banner) or quieter (tag)? Recommendation: **quieter** — extensions are normal business, not an incident. Loud only if reductions are involved.
- Should we surface extensions on the **Tools** detail page (e.g. "this tool received €10k in extensions this year")? Out of scope for v1, but the `linked_tool_id` makes it trivial later.

## 8. Files this would touch (rough scope)

- `src/lib/db/schema.ts` — add table + enum
- `src/lib/db/migrations/` — new migration
- `src/lib/validators.ts` — new schemas
- `src/actions/budget-extensions.ts` — new file
- `src/actions/budget.ts` — `getBudgetWithCosts` augments periods with extension info; helpers for effective ceiling
- `src/app/budget/components/budget-health-hero.tsx` — show baseline + extended
- `src/app/budget/components/budget-detail-client.tsx` — render extensions card, open dialog
- `src/app/budget/components/budget-extensions-card.tsx` — **new**
- `src/app/budget/components/dialogs/add-extension-dialog.tsx` — **new**
- `src/app/budget/components/period-allocations-table.tsx` — show "+ from extension" sub-label
- `src/components/dashboard/admin/budget-hero-section.tsx` — small inline tag
- `src/components/reports/budget/*` — baseline reference line on chart

## 9. Visual mockups

See `mockup.html` in this folder. Open it in a browser; it contains five views laid out vertically:

1. Budget detail page with extensions section
2. Add extension dialog
3. Dashboard budget widget with extension tag
4. Reports forecast with baseline reference line
5. Change history feed showing extension entries

The mockups use the exact `oklch()` theme tokens from `src/app/globals.css` and the Inter typeface, and include a light/dark toggle.
