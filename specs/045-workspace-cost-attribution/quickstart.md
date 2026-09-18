# Quickstart: Workspace-Based Claude Cost Attribution

**Feature**: 045-workspace-cost-attribution | **Date**: 2026-09-18

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

Trigger the cost sync (admin UI → Settings → Sync, or the cron route with `CRON_SECRET`):

```bash
curl -X POST localhost:3000/api/sync/anthropic-api-costs \
  -H "Authorization: Bearer $CRON_SECRET"
```

Verify line items landed with the dimensions that used to be discarded:

```sql
SELECT date, model, token_type, context_window, service_tier, cost_cents
FROM anthropic_workspace_cost_items
WHERE workspace_id = '<a workspace id>'
ORDER BY date DESC, cost_cents DESC
LIMIT 20;
```

You should see `cache_creation.ephemeral_1h_input_tokens` and `…_5m_…` as separate rows, and `0-200k` / `200k-1M` context windows — the three "residual gaps" from docs/anthropic-cost-accuracy.md, now data instead of assumptions.

Confirm the rollup still matches (it is now derived from these rows):

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

Expect the `Indie - <Name>` workspaces in `billed` mode, and the project workspaces (`AI Code Review Trial`, `Jungfraubahnen`, `Automations`, `Ensinger Plastics`) in `unattributed` — that is correct and deliberate; their spend is out of scope for this feature and stays in org totals only.

## 3. Verify SC-001 (the headline criterion)

For a **completed** month and a user in a single-owner workspace, these must be equal to the cent:

```sql
-- Hub's per-user figure
SELECT SUM(COALESCE(attributed_cost_cents, computed_cost_cents))
FROM anthropic_usage_metrics
WHERE user_id = <id> AND date BETWEEN '2026-08-01' AND '2026-08-31';

-- Billed cost of their workspace
SELECT SUM(cost_cents) FROM anthropic_workspace_costs
WHERE workspace_id = '<their workspace>' AND date BETWEEN '2026-08-01' AND '2026-08-31';
```

Cross-check the second figure against the Cost page in the Claude Console for the same workspace and month.

## 4. Verify the API contract

```bash
curl -s localhost:3000/api/profile -H "Cookie: <session>" | jq '.costData'
```

`monthlyTotalCents`, `dailyBreakdown` and `models[]` must still be present with their original meaning (SC-008); `attribution` is new. A consumer that ignores `attribution` must keep working.

## 5. Exercise apportionment without a shared workspace

The current estate has no multi-owner workspace, so cover this path with unit tests rather than live data:

```bash
pnpm vitest run tests/unit/anthropic/cost-attribution.test.ts
```

The critical assertion is that apportioned parts sum **exactly** to the billed total for every split, including 1-cent totals and zero-weight owners.

To try it end to end, temporarily insert a second `manual` owner row for one indie workspace, re-run the sync, and confirm the two users' figures sum to the workspace total. Remove the row afterwards.

## 6. Exercise reconciliation

Nudge a workspace's rollup out of line and re-run the cost sync:

```sql
UPDATE anthropic_workspace_costs
SET cost_cents = cost_cents * 3
WHERE workspace_id = '<a workspace>' AND date = '2026-09-10';
```

A warning `sync_event` naming the workspace, the period and both figures should appear in Settings → Sync. Restore the value afterwards (or re-run the sync, which overwrites it from line items).

## 7. Check the current-day path

Before the day completes, a user with usage today should show a month-to-date figure with a separately identifiable estimated portion, and the today badge. After the day completes and the next cost sync runs, the same day should switch to `billed` with no double counting (contract R5).

## Troubleshooting

| Symptom                                                       | Likely cause                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost sync 400s with "ending date must be after starting date" | Running on the 1st before any complete day exists — expected, the sync returns 0 rows by design                                                    |
| All workspaces `unattributed`                                 | `anthropic_workspace_owners` seed did not run, or no key has resolved yet; check `anthropic_sync_status.resolved_workspace_id`                     |
| A user's cost drops to zero                                   | Their key stopped resolving — reconciliation should have warned; check for a workspace with spend and no owner                                     |
| Line-item upsert conflicts                                    | The NULL-handling in the unique index grain; see data-model.md — `NULL`s inside the grain columns need `COALESCE(...,'')` or a generated grain key |
