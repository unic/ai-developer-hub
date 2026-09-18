# Quickstart: Usage-Based Cost Model

**Feature**: 045-usage-based-cost-model | **Date**: 2026-09-18

How to exercise and verify this feature locally.

## Prerequisites

- `ANTHROPIC_ADMIN_API_KEY` in `.env.local` — an Admin API key (`sk-ant-admin01-…`) or an `org:admin` OAuth token. Workspace-scoped keys are rejected by the Admin API.
- A database you may migrate. **From a worktree, create an isolated Neon branch first** (`neon-worktree-branch` skill) — never run `db:push` or `db:migrate` against the default branch from a worktree.

```bash
pnpm install
pnpm db:migrate        # applies 0032
pnpm dev
```

## 1. Ingest line items

```bash
curl -X POST localhost:3000/api/sync/anthropic-api-costs \
  -H "Authorization: Bearer $CRON_SECRET"
```

Verify the dimensions that used to be discarded now land:

```sql
SELECT date, model, token_type, context_window, service_tier, cost_cents
FROM anthropic_workspace_cost_items
WHERE workspace_id = '<a workspace id>'
ORDER BY date DESC, cost_cents DESC
LIMIT 20;
```

You should see `cache_creation.ephemeral_1h_input_tokens` and `…_5m_…` as separate rows, and `0-200k` / `200k-1M` context windows — the three "residual gaps" from docs/anthropic-cost-accuracy.md, now data.

Confirm the rollup still matches (it is derived from these rows):

```sql
SELECT c.date, c.cost_cents AS rollup, SUM(i.cost_cents) AS from_items
FROM anthropic_workspace_costs c
JOIN anthropic_workspace_cost_items i
  ON i.workspace_id IS NOT DISTINCT FROM c.workspace_id AND i.date = c.date
GROUP BY c.date, c.cost_cents
HAVING c.cost_cents <> SUM(i.cost_cents);   -- must return zero rows
```

## 2. Check attribution

```sql
SELECT w.name,
       COUNT(o.user_id) AS owners,
       CASE COUNT(o.user_id) WHEN 0 THEN 'unattributed'
                             WHEN 1 THEN 'billed'
                             ELSE 'apportioned' END AS mode
FROM anthropic_workspaces w
LEFT JOIN anthropic_workspace_owners o
  ON o.workspace_id IS NOT DISTINCT FROM w.workspace_id
WHERE w.deprecated_at IS NULL
GROUP BY w.name
ORDER BY owners DESC, w.name;
```

Expect `Indie - <Name>` workspaces in `billed` mode and the project workspaces (`AI Code Review Trial`, `Jungfraubahnen`, `Automations`, `Ensinger Plastics`) in `unattributed` — correct and deliberate. Their spend is out of scope and stays in org totals only.

## 3. Verify SC-001 — per-user cost equals the Console

For a **completed** month and a user in a single-owner workspace, these must be equal to the cent:

```sql
SELECT SUM(COALESCE(attributed_cost_cents, computed_cost_cents))
FROM anthropic_usage_metrics
WHERE user_id = <id> AND date BETWEEN '2026-08-01' AND '2026-08-31';

SELECT SUM(cost_cents) FROM anthropic_workspace_costs
WHERE workspace_id = '<their workspace>' AND date BETWEEN '2026-08-01' AND '2026-08-31';
```

Cross-check the second against the Cost page in the Claude Console for the same workspace and month.

## 4. Verify SC-004 — expected spend by pricing model

Confirm the migration flipped exactly the Claude Console tiers:

```sql
SELECT t.name AS tool, ac.name AS tier, ac.pricing_model, ac.monthly_cost_cents
FROM access_tiers ac JOIN ai_tools t ON t.id = ac.tool_id
ORDER BY ac.pricing_model DESC, t.name, ac.name;
```

Five `usage` rows (`indie-profile`, `boost-starter`, `boost-advanced`, `boost-expert`, `boost-leader`); everything else `seat`.

Then open the budget page for a **completed** period:

- Seat tools: expected unchanged to the cent from before the feature (J1). Compare against a pre-deploy screenshot or a prior `getBilledCostsTimeSeries` response.
- `Claude Console`: expected should fall from ~$3,650/month toward measured consumption (August: $398.69), labelled `measured` (J2).
- An open period should read `projected`; a brand-new assignment with no history should read `allowance_fallback`.

## 5. Verify SC-005 — allowance is never shown as cost

Walk the tier price through its surfaces: tool detail, the assignment dialog, the approval dialog, user detail, the licence register. For `usage` tiers every one must say **allowance**; for `seat` tiers the wording must be exactly as before. No screen may add an allowance to a consumption or a purchase (J6).

## 6. Verify SC-006 — credits are cash, not cost

Record an opening balance for the Claude Console tool, then mark a top-up invoice as a credit purchase:

```sql
SELECT id, invoice_number, invoice_date, amount_cents FROM invoices
WHERE vendor ILIKE '%anthropic%' ORDER BY invoice_date DESC LIMIT 10;
```

Then check the period the purchase lands in:

- Period cost for the tool equals measured consumption, unchanged by the purchase (C2).
- The purchase appears as a purchase row, never folded into cost (C3).
- The credits panel shows `opening + purchases − consumption` with its as-of date and "derived by the Hub" (C4/C6).
- Remove the opening balance and confirm the balance reads **unavailable**, not zero (C5).

## 7. Verify SC-009 — recorded caps

Record a cap for an indie workspace, then confirm the workspace view shows consumption, cap, utilisation, the last-confirmed date, and a statement that the Hub does not enforce it. Set the cap to something other than the owner's $125 allowance and confirm the mismatch flag shows both figures (W4).

Check the three states are distinct (W2):

```sql
SELECT w.name, l.limit_cents, l.confirmed_at
FROM anthropic_workspaces w
LEFT JOIN anthropic_workspace_limits l
  ON l.workspace_id IS NOT DISTINCT FROM w.workspace_id
WHERE w.deprecated_at IS NULL ORDER BY w.name;
```

A `NULL` row must render as "no cap recorded" — never as unlimited and never as 0.

## 8. Exercise apportionment without a shared workspace

No multi-owner workspace exists today, so cover this with unit tests:

```bash
pnpm vitest run tests/unit/anthropic/cost-attribution.test.ts
```

The critical assertion is that apportioned parts sum **exactly** to the billed total for every split, including 1-cent totals and zero-weight owners. To try it end to end, temporarily insert a second `manual` owner row for one indie workspace, re-run the sync, confirm the two users' figures sum to the workspace total, then remove the row.

## 9. Exercise reconciliation

```sql
UPDATE anthropic_workspace_costs
SET cost_cents = cost_cents * 3
WHERE workspace_id = '<a workspace>' AND date = '2026-09-10';
```

Re-run the cost sync; a warning `sync_event` naming the workspace, period and both figures should appear in Settings → Sync. Re-running the sync restores the value from line items.

## 10. Check the current-day path

Before the day completes, a user with usage today shows month-to-date with a separately identifiable estimated portion. After the day completes and the next cost sync runs, that day switches to `billed` with no double counting (R5).

## Troubleshooting

| Symptom                                                       | Likely cause                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost sync 400s with "ending date must be after starting date" | Running on the 1st before any complete day exists — expected; the sync returns 0 rows by design                                                             |
| All workspaces `unattributed`                                 | The owners seed did not run, or no key has resolved; check `anthropic_sync_status.resolved_workspace_id`                                                    |
| A user's cost drops to zero                                   | Their key stopped resolving — reconciliation should have warned; look for a workspace with spend and no owner                                               |
| Line-item upsert conflicts                                    | NULL handling in the unique-index grain; see data-model.md — nullable grain columns need `COALESCE(...,'')` or a generated grain key                        |
| Expected spend for a usage tool reads zero                    | No consumption history and no allowance fallback — check `pricing_model` is set and the assignment is active in the period                                  |
| Credit balance looks wrong                                    | Opening balance stale or a top-up unrecorded. A negative balance is shown deliberately (C7) — it means something is missing, not that the arithmetic failed |
