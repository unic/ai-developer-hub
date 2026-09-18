# Tasks: Workspace-Based Claude Cost Attribution

**Input**: Design documents from `/specs/045-workspace-cost-attribution/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/cost-attribution.md

**Tests**: Included — the constitution mandates unit coverage for shared business logic. Apportionment (FR-004) and reconciliation (FR-008) are pure functions handling money and are tested exhaustively; the sync upsert path gets integration coverage.

**Organization**: Grouped by the six plan phases, which map onto the user stories. Each phase is independently deployable and leaves the app correct.

**Parallel marker `[P]`**: different files, no ordering dependency.

## Phase 1: Schema (foundational — blocks everything)

**Purpose**: Land the additive schema so later phases have somewhere to write. No behaviour change on deploy.

- [ ] T001 Add `attribution_mode` pgEnum (`billed` | `apportioned` | `unattributed`) and the `anthropicWorkspaceCostItems` table to `src/lib/db/schema.ts` per data-model.md §"New table: anthropic_workspace_cost_items", including the two partial unique indexes for nullable `workspace_id` and the `cost_cents >= 0` check
- [ ] T002 Add the `anthropicWorkspaceOwners` table to `src/lib/db/schema.ts` (FK `user_id` → `users.id` ON DELETE CASCADE, `source` = `resolved` | `manual`, unique `(workspace_id, user_id)` with the NULL-workspace partial split)
- [ ] T003 [P] Add `deprecatedAt` / `deprecatedReason` to `anthropicWorkspaces` in `src/lib/db/schema.ts`
- [ ] T004 [P] Add nullable `attributedCostCents` (integer) and `attributionMode` (enum) to `anthropicUsageMetrics` in `src/lib/db/schema.ts`
- [ ] T005 Generate migration `0032` via `pnpm db:generate`; append the data-migration steps by hand: seed `anthropic_workspace_owners` from `anthropic_sync_status` where `resolved_api_key_id IS NOT NULL` (`source = 'resolved'`), and mark the 12 `boost-*` workspaces deprecated **by explicit workspace id list**, not a `LIKE` pattern
- [ ] T006 Review the migration with the `drizzle-migration-reviewer` agent; confirm additive-only, no table rewrite, no destructive change, and that the partial unique indexes match the existing `anthropic_workspace_costs` pattern
- [ ] T007 Apply against an isolated Neon branch (see `neon-worktree-branch` skill — never the default branch from a worktree) and verify the seed produced one owner row per API-key holder

**Checkpoint**: `pnpm typecheck` and `pnpm test` green; schema deployed; every existing surface behaves identically.

## Phase 2: Line-item ingestion (US1 groundwork)

**Goal**: Hold billed cost at full granularity. Existing consumers keep reading the daily rollup unchanged.

- [ ] T008 Add `group_by[]=description` to the query built in `fetchCostReport()` in `src/lib/sync/sources/anthropic-workspace.ts`. `costReportResultSchema` already declares `model`, `cost_type`, `token_type`, `context_window`, `service_tier` — they are parsed and then discarded today, so no schema widening is needed, only stopping the discard
- [ ] T009 Add `aggregateCostLineItems(buckets)` to `src/lib/sync/sources/anthropic-workspace.ts`, returning one row per (workspace, date, model, cost_type, token_type, context_window, service_tier); keep `aggregateDailyCosts()` but re-express it as a sum over line items so the rollup cannot drift from its source (plan risk 5)
- [ ] T010 Batch-upsert line items in `fetchAndUpsertWorkspaceCosts()` using the same two-partial-index ON CONFLICT pattern the rollup already uses; keep writing the rollup in the same transaction
- [ ] T011 [P] Unit-test `aggregateCostLineItems` in `tests/unit/sync/anthropic-cost-line-items.test.ts`: multiple results per bucket, null `workspace_id` (default workspace), null `model` for `web_search` / `code_execution` cost types, and that summing line items reproduces `aggregateDailyCosts` exactly
- [ ] T012 Run a historical backfill through the existing month-loop (`run({ backfillStartDate })`) against the Neon branch; record wall-clock against `maxDuration = 300` (plan risk 4) and the row count actually produced versus the ~12k/month estimate

**Checkpoint**: line items present for the backfilled range; `anthropic_workspace_costs` values unchanged to the cent from before this phase.

## Phase 3: Attribution (US1 core)

**Goal**: Compute and store per-user billed/apportioned cost. Nothing reads it yet.

- [ ] T013 Create pure module `src/lib/anthropic/cost-attribution.ts`: `AttributionMethod` type, `deriveMode(ownerCount)`, `apportion(billedCents, weights)` implementing largest-remainder with ascending-`userId` tie-break (contract R2) and the all-zero-weights even split (R3), and `attributeDay({ billedCents, owners, computedByUser })` returning `AttributedDailyCost[]`
- [ ] T014 Unit-test `src/lib/anthropic/cost-attribution.ts` in `tests/unit/anthropic/cost-attribution.test.ts` — this is the money-handling test and must be exhaustive: exact summation across 2/3/5 owners, 1-cent and 0-cent totals, all-zero weights, a single zero-weight owner among non-zero ones, deterministic tie-breaks, and a property-style check that `sum(parts) === billedCents` over a spread of random splits
- [ ] T015 Add an attribution step to the cost sync in `src/lib/sync/sources/anthropic-workspace.ts`: after line items are written, for each workspace-day resolve owners, call `attributeDay`, and write `attributed_cost_cents` / `attribution_mode` back onto the matching `anthropic_usage_metrics` rows in batches
- [ ] T016 [P] Maintain `anthropic_workspace_owners` from `resolveAllMappings()` in `src/lib/anthropic-sync.ts`: upsert a `resolved` row when a key resolves to a workspace, and never overwrite or delete a `manual` row (data-model.md §Population)
- [ ] T017 [P] Integration test in `tests/integration/` asserting invariants I1–I3 from contracts/cost-attribution.md §6 against seeded line items and usage rows

**Checkpoint**: `attributed_cost_cents` populated for complete days; every existing read path still returns exactly what it returned before.

## Phase 4: Read-path swap (US1 visible — 🎯 the user-facing change)

**Goal**: Per-user cost becomes the billed figure, and every figure states its method.

> Ships with the restatement announcement (plan risk 1), not before it.

- [ ] T018 [US1] Swap the read rule in `src/lib/profile-data.ts` to `COALESCE(attributed_cost_cents, computed_cost_cents)` and add the `attribution` object plus per-day `method` per contracts/cost-attribution.md §4.1, keeping every existing field name and meaning
- [ ] T019 [P] [US1] Same swap in `src/actions/anthropic-users.ts` (6 aggregate sites) and expose `attributionMethod` per user
- [ ] T020 [P] [US1] Same swap in `src/lib/anthropic/queries.ts` and `src/actions/dashboard.ts`
- [ ] T021 [P] [US1] Same swap in `src/lib/mcp/data.ts`; add `attribution` to `get_user_cost_profile` / `get_claude_spend_summary` and `attributionMethod` to `list_claude_users` (contract §4.2)
- [ ] T022 [P] [US1] Same swap in `src/lib/scenarios/queries.ts` — note this moves saved forecast scenarios (feature 041) onto the billed basis; call it out in the announcement
- [ ] T023 [US2] Confirm month-to-date composition in `src/lib/anthropic/estimate-today.ts` consumers: complete days from attribution, current day from the estimate, never double counted (contract R5). The calibration ratio should now sit near 1.0 — assert it is not silently compensating for a pricing gap
- [ ] T024 [US1] Attribution badge component in `src/components/claude/`, used on user detail, user table and profile surfaces; text not colour alone (constitution IV); no badge for the `billed` case (contract §4.3)
- [ ] T025 [P] Update `docs/profile-api-integration-guide.md` with the added fields and an explicit note that existing fields are unchanged but their **values** are now billed-based
- [ ] T026 [US1] Produce the restatement announcement: per affected user, before/after monthly totals for every restated month, and the reason. This is a deliverable of the phase, not a follow-up

**Checkpoint**: SC-001 verifiable — a single-owner user's completed month equals the Console figure exactly.

## Phase 5: Reconciliation (US3)

**Goal**: The remaining estimate gets a watchdog.

- [ ] T027 [US3] Create pure module `src/lib/anthropic/reconciliation.ts`: `detectDivergence({ workspaceId, period, billedCents, attributedCents })` applying the `max(500, billed * 0.05)` tolerance and returning a structured finding with both figures and the ratio
- [ ] T028 [P] [US3] Unit-test it in `tests/unit/anthropic/reconciliation.test.ts`: below/at/above tolerance, the small-absolute floor, zero billed with non-zero attributed, and a workspace with spend and no owners
- [ ] T029 [US3] Wire it into the cost sync in `src/lib/sync/sources/anthropic-workspace.ts`, recording warning `sync_events` via the existing non-fatal `appendError` path
- [ ] T030 [P] [US3] Record a warning `sync_event` naming any model absent from the price table in `src/lib/sync/sources/anthropic-usage.ts` (replacing reliance on the `pricing_resolved` flag nobody reads)
- [ ] T031 [P] [US3] Surface both warning kinds on the admin sync view in `src/app/settings/sync/`

**Checkpoint**: SC-004 verifiable — seed a diverging workspace, run the sync, see the event.

## Phase 6: Ownership admin & boost-\* deprecation (US4, US5)

- [ ] T032 [US4] Server actions in `src/actions/anthropic-global.ts` to list workspace ownership and set/clear a `manual` owner, returning the project's `{ success, data } | { success, error }` shape
- [ ] T033 [US4] Workspace list gains owner(s) and attribution mode columns plus the override action, in `src/app/claude/` — unattributed workspaces shown with spend intact (FR-007)
- [ ] T034 [P] [US5] Exclude `deprecated_at IS NOT NULL` workspaces from the workspace list, cap-utilisation views and configured-cap aggregates, with a "show deprecated" toggle
- [ ] T035 [P] [US5] Skip deprecated workspaces in cap alerting in `src/actions/alerts.ts`
- [ ] T036 [US5] Verify historical months still include deprecated workspaces' spend (SC-006) — the exclusion is presentational only (invariant I5)

**Checkpoint**: all success criteria verifiable; `boost-*` gone from the working views, intact in history.

## Dependencies

- Phase 1 blocks everything.
- Phase 2 blocks phase 3 (attribution needs line items); phase 3 blocks phase 4 (reads need stored attribution).
- Phase 5 depends on phase 3 (needs attributed figures) but not on phase 4.
- Phase 6 is independent of phases 2–5 and can ship any time after phase 1. If the team wants an early visible win, **T034/T035 (boost-\* deprecation) can ship immediately after phase 1**.

## Validation

- `pnpm lint` (zero warnings), `pnpm typecheck`, `pnpm test`, `pnpm test:integration`
- Manual: quickstart.md walkthrough
- SC-001 check: for a completed month, compare each single-owner user's Hub total against the Console figure — must be 0 cents apart
