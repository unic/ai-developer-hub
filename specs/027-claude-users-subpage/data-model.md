# Spec 027 · Data model

Schema analysis for the Claude Console **Users** sub-page. Like spec 026 Phases 1+2, this is pure UI + aggregation over existing tables — **no migrations**.

## No schema changes

Everything the Users page renders comes from tables that already exist:

| Table | What we read from it |
|---|---|
| `anthropic_usage_metrics` | Per-user, per-day, per-model token counts and `computed_cost_cents`. Primary key grain: `(user_id, date, model)`. |
| `anthropic_sync_status` | `resolved_workspace_id` (added by spec 026 migration 0018) and `resolved_api_key_id` for the "users with no API key" KPI. Per-user row keyed by `user_id`; `user_id = 0` is the global lock sentinel (`LOCK_USER_ID` in `src/lib/anthropic-sync.ts:23`) and must be filtered out of every user-facing query. |
| `anthropic_workspaces` | Workspace name + `display_color` for the workspace cell in the users table and for color coding in the daily-spend-by-user chart. |
| `users` | `name`, `email`, `circle` (team grouping), `profile` (boost / maxed / indie), `status`, `role`. Exclude `role = 'admin'` is *not* applied — admins can be heavy users too. Exclude `status = 'inactive'` from the default view, but keep it available behind a filter. |
| `license_assignments` | Used only as a denominator for the "users with no API key" KPI tile: count users with an active Anthropic license assignment whose `anthropic_sync_status.resolved_api_key_id IS NULL`. |

No new tables, no new columns. The page is read-only over the existing aggregate.

## The canonical user-list query

The page's main table is driven by a single query. Variants for the KPI strip and the daily-spend chart are projections of this same shape:

```sql
SELECT
  u.id            AS user_id,
  u.email,
  u.name,
  u.circle,
  u.profile,
  u.status,
  s.resolved_workspace_id,
  w.name          AS workspace_name,
  w.display_color AS workspace_color,
  COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents,
  COALESCE(SUM(
    m.uncached_input_tokens
    + m.cache_read_input_tokens
    + m.cache_creation_input_tokens
    + m.output_tokens
  ), 0)::bigint AS total_tokens,
  COUNT(DISTINCT m.model)::int AS models_used,
  MAX(m.date)     AS last_active
FROM users u
LEFT JOIN anthropic_usage_metrics m
       ON m.user_id = u.id
      AND m.date BETWEEN $1 AND $2
LEFT JOIN anthropic_sync_status s
       ON s.user_id = u.id
LEFT JOIN anthropic_workspaces w
       ON w.workspace_id IS NOT DISTINCT FROM s.resolved_workspace_id
WHERE u.id <> 0                    -- exclude the LOCK_USER_ID sentinel
GROUP BY u.id, u.email, u.name, u.circle, u.profile, u.status,
         s.resolved_workspace_id, w.name, w.display_color
ORDER BY cents DESC, u.email ASC;  -- ties broken by email
```

`IS NOT DISTINCT FROM` on the workspace join is identical to the trick spec 026 used for the top-users-in-a-workspace query: it treats `NULL` (default workspace) as a real value so users in the default workspace are not silently dropped.

`LEFT JOIN` on `anthropic_usage_metrics` (rather than `INNER JOIN`) is deliberate — users with zero spend in the period must still appear when "Hide $0" is off, because the "users with no API key" KPI is meaningless if those rows are pre-filtered out.

## KPI tiles — what each one reads

1. **Active users · current month** — `COUNT(*) FILTER (WHERE cents > 0)` over the canonical query. MoM delta runs the same query for the prior month and diffs.
2. **Top spender** — first row of the canonical query (already sorted DESC).
3. **Top-5 concentration** — `SUM(cents) FILTER (rank <= 5) / SUM(cents) * 100`, computed in the action to avoid a second query.
4. **Users with no API key** — separate query: `SELECT count(*) FROM users u LEFT JOIN anthropic_sync_status s ON s.user_id = u.id WHERE u.id <> 0 AND u.status = 'active' AND s.resolved_api_key_id IS NULL`. Optional: scope to users with an active Claude license assignment (`license_assignments.tool_id = <claude>` AND `status = 'active'`) so the count means "provisioned but unused", not "everyone who hasn't been onboarded".

## Daily spend by user (Phase 2)

The Phase 2 stacked chart re-uses the existing daily-totals-by-workspace pattern from spec 026 (`getDailyTotalsByWorkspace`), but pivots by user. Same shape, different `GROUP BY` column:

```sql
SELECT
  m.date,
  m.user_id,
  COALESCE(u.name, u.email) AS user_label,
  SUM(m.computed_cost_cents)::int AS cents
FROM anthropic_usage_metrics m
JOIN users u ON u.id = m.user_id
WHERE m.date BETWEEN $1 AND $2
GROUP BY m.date, m.user_id, u.name, u.email
ORDER BY m.date, cents DESC;
```

Aggregation into "Top 5 users + Other" happens in the server action (same `topN` helper that the workspace chart uses), so the SQL stays simple and Postgres does not have to sort all users every day.

## Sparklines + Fastest growing (Phase 2)

The per-row sparkline column needs six monthly totals per user. This is the same `getWorkspaceSparklines()` pattern from spec 026, re-pivoted:

```sql
SELECT
  m.user_id,
  date_trunc('month', m.date)::date AS month,
  SUM(m.computed_cost_cents)::int   AS cents
FROM anthropic_usage_metrics m
WHERE m.date >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
GROUP BY m.user_id, date_trunc('month', m.date);
```

The action pivots this into `Record<userId, { month, totalCents }[]>` server-side. The "Fastest growing users (6mo)" chips reuse the spec 026 `getTopMovers` logic verbatim — top 3 by **positive** % delta only, `>= $5` floor on the prior 3-month window — but grouped by `user_id` instead of `workspace_id`. The action / type names can stay as `get*` parallels (`getUserTopMovers`, `UserTopMover`) for git-history continuity.

## Caveats (must be surfaced in UI)

These are inherited from spec 026's data-model doc; they apply identically to the Users page because the underlying endpoints are the same.

- **Per-user totals do not sum to org / workspace totals.** Per-user data comes from Anthropic's usage report endpoint; org/workspace cost data comes from the cost report endpoint. Different rounding, different aggregation windows. The two will not reconcile exactly. The KPI strip on the Users page must not claim to be authoritative for org spend — that signal lives on the Workspaces tab. Surface both as separate views; do not pick a winner.

- **No real per-user "request" count.** `anthropic_usage_metrics` stores token counts only. The workspace top-users table currently approximates "requests" by summing all token columns; the Users page does the same, but labels the column **Tokens**, not Requests, to avoid implying a count we do not have.

- **Mid-month workspace moves are retroactive.** `resolved_workspace_id` reflects the user's *current* API key's workspace. If an admin moves a key mid-month, historical rows in `anthropic_usage_metrics` are retroactively re-attributed when the workspace cell renders. Acceptable; document on the page footnote.

- **Pricing may be unresolved.** `computed_cost_cents` for a row is unreliable when `pricing_resolved = false` (model pricing was unknown at sync time). Aggregate queries should sum across all rows but the action should also expose a `hasUnresolvedPricing` boolean from the same query so the UI can show a warning chip on affected user rows.

## Cache invalidation

All new server actions use the existing `"anthropic-workspace-costs"` cache tag — the hourly sync already calls `revalidateTag` on it, so no new revalidation plumbing is needed. (The tag is misleadingly named for historical reasons; in practice it covers every action that reads `anthropic_usage_metrics` and friends.)

## Out of scope

- Per-user budget limits. Anthropic does not expose a per-user cap; we have no precedent for org-side enforcement on individual users. If the cost-distribution histogram tells us a small number of users dominate, that is a future spec.
- Denormalizing `workspace_id` onto `anthropic_usage_metrics`. The join is fast enough at current scale; denormalizing would require backfilling the largest table in the schema every time a workspace assignment changes. Same reasoning as spec 026's data-model.md rejected this path.
- Per-user generalization across tools. This is Claude/Anthropic-specific. If Copilot ever needs an equivalent user-spend overview, it would need a parallel page built on Copilot's own data (which is licensing-driven, not metered, so the shape would be different anyway).
