# Spec 026 · Data model

Schema analysis and decisions for the `/claude` page redesign. Only Phase 3 introduces a schema change; Phases 1 + 2 are pure UI / aggregation over existing tables.

## No schema changes (Phases 1 + 2)

Phase 1 (header + sync pill + global metrics) and Phase 2 (workspace cards + drill-in) read from tables that already exist:

- `anthropic_workspace_costs` — daily cost per workspace (one row per `(workspace_id, YYYY-MM-DD)`; see "Per-day storage fix" below)
- `anthropic_workspaces` — workspace metadata
- `anthropic_workspace_limits` — admin-configured caps
- `anthropic_org_config` — org-wide billing budget
- `anthropic_sync_status` — sync state (existing column `workspace_sync_completed_at`)
- `sync_events` — used by the sync status pill

No new tables, no new columns, no migrations required for Phases 1 + 2.

### Per-day storage fix (post-implementation)

Although the schema for `anthropic_workspace_costs` has always declared a daily grain, the cost sync was originally writing one row per workspace per month (keyed to `YYYY-MM-01`). The 12-month and pacing visualizations exposed this immediately. Fixed in commit `e1428aa` (and refactored to batched upserts in `616c88c`):

- `/v1/organizations/cost_report` is now requested with `bucket_width=1d`.
- A pure `aggregateDailyCosts(buckets)` helper keys by `(workspace_id, YYYY-MM-DD)` derived from `bucket.starting_at` and sums the multiple per-cost-type rows Anthropic returns inside a single bucket.
- Upserts are batched into one statement per partial-index bucket (named workspaces / default workspace) — two round-trips per sync regardless of date range.
- Backfill of historical rows requires `scripts/backfill-anthropic-workspace-costs.ts` (TRUNCATE + re-fetch).

## User → workspace mapping (Phase 3 decision)

Phase 3 needs to render "top users in this workspace" inside the workspace drill-in, but the existing schema has no direct user→workspace relationship. Anthropic's usage report is keyed by user; the cost report is keyed by workspace; nothing bridges the two.

Three potential bridges were evaluated:

1. **`license_assignments.workspace` text column** — already exists (`src/lib/db/schema.ts:222`) but is a free-form admin-entered string, not tied to Anthropic's workspace IDs. Rejected as brittle — admins type "Marketing" while Anthropic returns `wrkspc_01ABC...`.
2. **Anthropic's `workspace_id` on each API key** — Anthropic's `/v1/organizations/api_keys` response includes `workspace_id` on every key. The codebase already calls this endpoint via `fetchOrgApiKeys()` (`src/lib/anthropic-keys.ts:20-56`), but the Zod schema `orgApiKeySchema` (lines 5-11) only captures `id, name, partial_key_hint, status, type` — `workspace_id` is parsed away. **Chosen path.**
3. **Add `workspace_id` directly to `anthropic_usage_metrics`** — denormalized, fast queries, but requires backfilling the large per-user-day-model table on every workspace move. Rejected as too expensive for the marginal query-speed gain.

## Chosen approach

- Extend `orgApiKeySchema` in `src/lib/anthropic-keys.ts` to capture `workspace_id: z.string().nullable()`. Anthropic returns `null` for keys in the org's default workspace; that null is meaningful and must be preserved (not coerced to a string).
- Add one nullable column to `anthropic_sync_status`:
  ```sql
  ALTER TABLE anthropic_sync_status
    ADD COLUMN resolved_workspace_id varchar(100);
  ```
- Update `resolveAllMappings()` in `src/lib/anthropic-sync.ts:143-221`: when persisting the resolved `api_key_id`, also persist the `workspace_id` from the matching entry in the `orgKeys` array. Same row, same upsert — no extra round-trip.
- Phase 3 queries join `anthropic_usage_metrics.user_id → anthropic_sync_status.user_id → resolved_workspace_id`.

## Reference query

The canonical Phase 3 "top users in a workspace" query:

```sql
SELECT u.id, u.email, u.name, SUM(m.computed_cost_cents) AS cents
FROM anthropic_usage_metrics m
JOIN anthropic_sync_status s ON s.user_id = m.user_id
JOIN users u                  ON u.id      = m.user_id
WHERE s.resolved_workspace_id IS NOT DISTINCT FROM $1   -- $1 = NULL for default workspace
  AND m.date BETWEEN $2 AND $3
GROUP BY u.id, u.email, u.name
ORDER BY cents DESC
LIMIT 10;
```

`IS NOT DISTINCT FROM` handles the default-workspace null sentinel cleanly — a plain `=` would silently drop every user assigned to the default workspace.

## Caveats (must be surfaced in UI)

- **Per-user totals do not sum to workspace totals.** Per-user data comes from Anthropic's usage report endpoint; workspace cost data comes from the cost report endpoint. Different rounding rules, different aggregation windows. The two will not reconcile exactly. The UI must show both as separate signals — do NOT add a footnote saying "if numbers differ, X is correct"; surface both and let the admin compare.

- **Mid-month workspace moves.** `resolved_workspace_id` reflects the user's *current* API key's workspace. If an admin moves a user's API key to a different workspace mid-month, historical usage rows in `anthropic_usage_metrics` will be retroactively attributed to the new workspace (because the join goes through the current `anthropic_sync_status` row, not a historical record). This is acceptable but must be documented in the UI footnote on the workspace drill-in.

## Backfill

The Phase 3 mapping was originally planned without a backfill — but two backfill scripts shipped after live data exposed gaps. Both are idempotent and safe to re-run.

- `scripts/backfill-anthropic-workspace-costs.ts` — one-off after the per-day storage fix. Operators should TRUNCATE `anthropic_workspace_costs` and run this to re-fetch historical months with `bucket_width=1d`. New syncs already write per-day rows, so no further intervention is required.
- `scripts/backfill-anthropic-workspace-mapping.ts` — retro-populates `resolved_workspace_id` for users whose `anthropic_sync_status` row already had a `resolved_api_key_id` from spec 016 *before* migration 0018 added the column. `resolveAllMappings()` only re-resolves users whose mapping is missing or whose key changed, so existing rows would otherwise keep `resolved_workspace_id = NULL` forever. The script queries `/v1/organizations/api_keys` once, builds an `api_key_id → workspace_id` map, and updates every row in place.
- Historical `anthropic_usage_metrics` rows still do NOT need backfilling — they're attributed via the live join at query time, not a denormalized column.
- Users with revoked / disabled API keys still won't get a `workspace_id` resolved; their rows will be excluded from per-workspace queries.

## Out of scope

This data-model.md does NOT cover:

- Schema for the workspace-level *cost* data (already exists from spec 018).
- Anthropic credit balance (still not exposed by the Anthropic API).
- Per-tool generalization. This is Claude/Anthropic-specific; if GitHub Copilot ever needs per-workspace user attribution, it would need a parallel mapping built on Copilot's own org/team primitives.
