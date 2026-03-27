# Research: Multiple Claude API Plan Connections

**Feature**: 026-multiple-api-plans
**Date**: 2026-03-27

## R1: Admin API Key Storage Migration (env var → database)

**Decision**: Store plan admin API keys encrypted in a new `anthropic_plan_connections` database table using the existing AES-256-GCM encryption (`src/lib/crypto.ts`). Auto-import the current `ANTHROPIC_ADMIN_API_KEY` env var as the first plan on initial migration.

**Rationale**: The existing `encryptApiKey()`/`decryptApiKey()` functions use AES-256-GCM with scrypt key derivation and the `API_KEY_ENCRYPTION_SECRET` env var. This same pattern is already proven for `licenseAssignments.apiKeyEncrypted`. Reusing it avoids introducing new crypto dependencies and keeps a consistent security posture.

**Alternatives considered**:
- Keep env vars per plan (e.g., `ANTHROPIC_ADMIN_API_KEY_1`): Rejected — doesn't scale, requires redeployment for changes, no admin UI control.
- Store keys in a secrets manager (Vault, AWS SSM): Over-engineered for current scale; can be adopted later without schema changes.

## R2: Sync Framework Extension Strategy

**Decision**: Extend the existing `withSyncLock()` / `syncEvents` / `makeCronSyncRoute()` framework to iterate all active plans. Each plan sync gets its own sync event. The advisory lock hash includes the plan ID to allow independent per-plan locking.

**Rationale**: The framework already supports `sourceType`-based advisory locks via FNV-32 hashing. Adding `planId` to the hash key (e.g., `hash("anthropic_api_usage:plan_42")`) gives independent locks per plan without changing the lock mechanism. The `syncEvents` table gains an optional `planConnectionId` column for audit trail.

**Alternatives considered**:
- Create a separate sync framework for plans: Rejected — violates DRY, the existing framework is well-designed.
- Use a single lock across all plans: Rejected — a slow plan would block all others.

## R3: Schema Extension Pattern for Existing Tables

**Decision**: Add a non-nullable `planConnectionId` foreign key to `anthropicUsageMetrics`, `anthropicWorkspaces`, `anthropicWorkspaceCosts`, and `anthropicSyncStatus`. Update unique constraints to include `planConnectionId`. Migration backfills existing rows with the auto-imported first plan's ID.

**Rationale**: A non-nullable FK enforces data integrity — every usage record must belong to a plan. The migration creates the first plan from the env var, then updates all existing rows to reference it. This is cleaner than nullable FKs with null-handling throughout the codebase.

**Alternatives considered**:
- Nullable `planConnectionId` with "legacy" data: Rejected — adds null-check complexity everywhere, clarification confirmed no null references.
- Separate tables per plan: Rejected — complicates queries, violates existing patterns.

## R4: API Key Resolution Across Plans

**Decision**: During sync, iterate all active plan connections. For each plan, decrypt its admin API key, call `fetchOrgApiKeys()` with that key, then resolve user API keys against that plan's org keys. Cache the resolved `planConnectionId` alongside `resolvedApiKeyId` in `anthropicSyncStatus`.

**Rationale**: The existing `resolveApiKeyId()` function matches user keys by suffix against org keys. Since each plan has its own set of org keys, running resolution per-plan naturally finds the right match. Caching the plan association avoids re-resolution on subsequent syncs.

**Alternatives considered**:
- Resolve against all plans' keys in a single pass: Possible but harder to attribute — would need to track which plan each org key came from. Per-plan iteration is simpler and clearer.
- Require admins to manually assign users to plans: Rejected — adds unnecessary friction, automatic resolution is better UX.

## R5: UI Integration for Plan Management

**Decision**: Extend the existing `/settings/integrations` page with a plan connections management section. Add plan label display to the admin user detail page's cost section. No changes to the user-facing profile page (plan source is transparent).

**Rationale**: The integrations page already has a `ClaudeCodeStatusCard` for Anthropic status. Expanding it to show a list of connected plans with add/edit/remove actions is a natural extension. The profile page stays unchanged per spec (SC-002).

**Alternatives considered**:
- New dedicated `/settings/claude-plans` page: Unnecessary — integrations page is the right home.
- Show plan info on user profile: Rejected — spec says plan source is transparent to end users.

## R6: Global Claude Dashboard Multi-Plan Aggregation

**Decision**: Extend the global Claude metrics dashboard to aggregate workspace costs across all plans. Add a plan filter dropdown alongside the existing workspace and month selectors. Workspaces include their plan label for disambiguation when multiple plans have workspaces with the same name.

**Rationale**: The existing `GlobalCostDashboardData` type already supports `workspaceBreakdown` arrays. Adding `planLabel` to each workspace entry and a top-level plan filter is minimal change.

**Alternatives considered**:
- Separate dashboard per plan: Rejected — admins need a unified view.
- No plan filter (always aggregated): Insufficient — admins need to drill into individual plan costs.

## R7: Sentinel Row Redesign for Multi-Plan Sync

**Decision**: Replace the single sentinel row (userId=0) locking pattern in `anthropicSyncStatus` with the framework's `withSyncLock()` advisory locks. The sentinel row pattern becomes per-plan by adding `planConnectionId` to the sync status table.

**Rationale**: The sentinel row was a custom lock before the sync framework existed. Now that `withSyncLock()` provides PostgreSQL advisory locks, the sentinel pattern is redundant for global locking. Per-plan sync status still needs rows to track `lastSyncStartedAt`, `syncedDays`, etc., so the table stays but keyed by (userId, planConnectionId).

**Alternatives considered**:
- Keep sentinel pattern with multiple sentinels per plan: Works but mixes two locking strategies.
- New dedicated lock table: Over-engineered — advisory locks in the framework are sufficient.
