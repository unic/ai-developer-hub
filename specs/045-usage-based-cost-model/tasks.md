# Tasks: Usage-Based Cost Model

**Input**: Design documents from `/specs/045-usage-based-cost-model/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/cost-attribution.md, contracts/pricing-and-credits.md

**Tests**: Included — the constitution mandates unit coverage for shared business logic. Apportionment (FR-004), expected spend (FR-010), the credit balance (FR-015) and reconciliation (FR-021) are pure functions handling money and are tested exhaustively; the sync and period-cost paths get integration coverage.

**Organization**: Grouped by the eight plan phases, which map onto the user stories. Each phase is independently deployable and leaves the app correct.

**Parallel marker `[P]`**: different files, no ordering dependency.

## Phase 1: Schema (foundational — blocks everything)

**Purpose**: Land the additive schema. `pricing_model` defaults to `seat`, so nothing changes on deploy.

- [ ] T001 Add the `attribution_mode` and `pricing_model` pgEnums and the `anthropicWorkspaceCostItems` table to `src/lib/db/schema.ts` per data-model.md, including the two partial unique indexes for nullable `workspace_id`, the `COALESCE`-based grain handling for nullable grain columns, and the `cost_cents >= 0` check
- [ ] T002 Add `anthropicWorkspaceOwners` to `src/lib/db/schema.ts` (FK `user_id` → `users.id` ON DELETE CASCADE, `source` = `resolved` | `manual`, unique `(workspace_id, user_id)` with the NULL-workspace partial split)
- [ ] T003 Add `creditPurchases` to `src/lib/db/schema.ts` (FKs to `ai_tools`, `invoices`, `users`; `amount_cents > 0` check; indexes on `(tool_id, purchased_at)` and `(invoice_id)`)
- [ ] T004 [P] Add `pricingModel` to `accessTiers` (NOT NULL DEFAULT `'seat'`) in `src/lib/db/schema.ts`
- [ ] T005 [P] Add `creditOpeningBalanceCents` / `creditOpeningBalanceAt` to `aiTools` in `src/lib/db/schema.ts`
- [ ] T006 [P] Add `deprecatedAt` / `deprecatedReason` to `anthropicWorkspaces`, and `confirmedAt` / `confirmedBy` to `anthropicWorkspaceLimits`, in `src/lib/db/schema.ts`
- [ ] T007 [P] Add nullable `attributedCostCents` and `attributionMode` to `anthropicUsageMetrics` in `src/lib/db/schema.ts`
- [ ] T008 Generate migration `0032` (`pnpm db:generate`), then append the data migration by hand: seed `anthropic_workspace_owners` from `anthropic_sync_status` where `resolved_api_key_id IS NOT NULL`; flip the five `Claude Console` tiers to `pricing_model = 'usage'` **by explicit tier id**; mark the 12 `boost-*` workspaces deprecated **by explicit workspace id** (never a `LIKE` pattern)
- [ ] T009 Review the migration with the `drizzle-migration-reviewer` agent: additive-only, no table rewrite, no destructive change, partial unique indexes matching the existing `anthropic_workspace_costs` pattern
- [ ] T010 Apply against an isolated Neon branch (`neon-worktree-branch` skill — never the default branch from a worktree); verify one owner row per API-key holder, exactly five tiers flipped, exactly 12 workspaces deprecated

**Checkpoint**: `pnpm typecheck` / `pnpm test` green; every existing surface behaves identically.

## Phase 2: Line-item ingestion

**Goal**: Hold billed cost at full granularity; existing consumers keep reading the daily rollup unchanged.

- [ ] T011 Add `group_by[]=description` to the query built in `fetchCostReport()` in `src/lib/sync/sources/anthropic-workspace.ts`. `costReportResultSchema` already declares `model`, `cost_type`, `token_type`, `context_window`, `service_tier` — they are parsed and discarded today, so this is stopping the discard, not widening the schema
- [ ] T012 Add `aggregateCostLineItems(buckets)` to the same file, one row per (workspace, date, model, cost_type, token_type, context_window, service_tier); re-express `aggregateDailyCosts()` as a sum over line items so the rollup cannot drift from its source (plan risk 8)
- [ ] T013 Batch-upsert line items in `fetchAndUpsertWorkspaceCosts()` with the two-partial-index ON CONFLICT pattern the rollup already uses; write the rollup in the same transaction
- [ ] T014 [P] Unit-test `aggregateCostLineItems` in `tests/unit/sync/anthropic-cost-line-items.test.ts`: several results per bucket, null `workspace_id`, null `model` for `web_search` / `code_execution`, and that summing line items reproduces `aggregateDailyCosts` exactly
- [ ] T015 Backfill through the existing month loop (`run({ backfillStartDate })`) against the Neon branch; record wall-clock against `maxDuration = 300` (plan risk 7) and actual row count versus the ~12k/month estimate

**Checkpoint**: line items present; `anthropic_workspace_costs` unchanged to the cent.

## Phase 3: Attribution

**Goal**: Compute and store per-user billed/apportioned cost. Nothing reads it yet.

- [ ] T016 Create pure `src/lib/anthropic/cost-attribution.ts`: `AttributionMethod`, `deriveMode(ownerCount)`, `apportion(billedCents, weights)` with largest-remainder and ascending-`userId` tie-break (R2) and the all-zero-weights even split (R3), and `attributeDay({ billedCents, owners, computedByUser })` → `AttributedDailyCost[]`
- [ ] T017 Unit-test it in `tests/unit/anthropic/cost-attribution.test.ts` — the money test, exhaustive: exact summation across 2/3/5 owners, 1-cent and 0-cent totals, all-zero weights, one zero-weight owner among non-zero, deterministic tie-breaks, and a property-style check that `sum(parts) === billedCents` over many random splits
- [ ] T018 Add the attribution step to the cost sync in `src/lib/sync/sources/anthropic-workspace.ts`: after line items are written, resolve owners per workspace-day, call `attributeDay`, batch-write `attributed_cost_cents` / `attribution_mode` onto matching `anthropic_usage_metrics` rows
- [ ] T019 [P] Maintain `anthropic_workspace_owners` from `resolveAllMappings()` in `src/lib/anthropic-sync.ts`: upsert a `resolved` row on key resolution; never overwrite or delete a `manual` row
- [ ] T020 [P] Integration test asserting invariants I1–I3 (contracts/cost-attribution.md §6) against seeded line items and usage rows

**Checkpoint**: `attributed_cost_cents` populated; every read path still returns what it returned before.

## Phase 4: Read-path swap and attribution labelling (US1 🎯)

> Ships with the restatement announcement (plan risk 1) — together with phase 5, not long before it.

- [ ] T021 [US1] Swap `src/lib/profile-data.ts` to `COALESCE(attributed_cost_cents, computed_cost_cents)` and add the `attribution` object plus per-day `method` (contracts/cost-attribution.md §4.1), keeping every existing field name and meaning
- [ ] T022 [P] [US1] Same swap in `src/actions/anthropic-users.ts` (6 aggregate sites); expose `attributionMethod` per user
- [ ] T023 [P] [US1] Same swap in `src/lib/anthropic/queries.ts` and `src/actions/dashboard.ts`
- [ ] T024 [P] [US1] Same swap in `src/lib/mcp/data.ts`; add `attribution` to `get_user_cost_profile` / `get_claude_spend_summary`, `attributionMethod` to `list_claude_users` (contract §4.2)
- [ ] T025 [P] [US1] Same swap in `src/lib/scenarios/queries.ts` — this moves saved forecast scenarios (041) onto the billed basis; name it in the announcement
- [ ] T026 [US6] Verify month-to-date composition in `estimate-today.ts` consumers: complete days from attribution, current day from the estimate, no double counting (R5). The calibration ratio should now sit near 1.0 — assert it is not silently compensating for a pricing gap
- [ ] T027 [US1] Attribution badge component in `src/components/claude/`, used on user detail, user table and profile surfaces; text not colour alone; no badge for `billed` (contract §4.3)
- [ ] T028 [P] Update `docs/profile-api-integration-guide.md`: added fields, and an explicit note that existing fields are unchanged but their **values** are now billed-based

**Checkpoint**: SC-001 verifiable — a single-owner user's completed month equals the Console figure exactly.

## Phase 5: Pricing models and expected spend (US2, US3)

- [ ] T029 [US2] Create pure `src/lib/expected-spend.ts`: `PricingModel`, `ExpectedSpendBasis`, `expectedSpendForPeriod({ pricingModel, assignments, measuredByMonth, period })` implementing the §2 decision table — measured for complete periods, trailing 3-complete-month mean for open ones, allowance fallback with no history; partial months never used as projection input (P6)
- [ ] T030 [US2] Unit-test it in `tests/unit/expected-spend.test.ts`: seat path byte-identical to `sumExpectedSpendCents` today (J1), measured path equals consumption (J2), projection ignores partial months, fallback marked as such, mixed portfolios sum across bases
- [ ] T031 [US2] Make `sumExpectedSpendCents` in `src/lib/budget-utils.ts` delegate to the new module, keeping its existing signature working for seat-only callers so the spec-042 test that pins it stays valid
- [ ] T032 [US2] Consume `ExpectedSpend` (value + basis) in `src/actions/budget.ts` — `getBudgetWithCosts` and the period rows
- [ ] T033 [P] [US2] Same in `src/actions/reports.ts` and `src/actions/dashboard.ts`; the spend-trend card's expected series carries its basis
- [ ] T034 [US3] Add `pricingModel` to tier create/edit in `src/actions/tools.ts` and the tool detail UI, defaulting to `seat`
- [ ] T035 [P] [US3] Allowance labelling across tier and assignment surfaces: `src/app/tools/[id]/`, `src/app/assignments/`, `src/app/requests/[id]/`, `src/app/users/[id]/` — "monthly allowance" for `usage`, unchanged wording for `seat` (L1–L3)
- [ ] T036 [P] [US3] Expected-spend basis shown wherever a projection could be mistaken for a measurement (L5); allowance, consumption and purchases never summed into one total (L4/J6)

**Checkpoint**: SC-004 and SC-005 verifiable; seat tools unchanged to the cent.

## Phase 6: Credit purchases and balance (US4)

- [ ] T037 [US4] Server actions in `src/actions/credits.ts`: record/reclassify an invoice as a credit purchase, record a tool's opening balance and its as-of date; project's `{ success, data } | { success, error }` shape
- [ ] T038 [US4] Exclude `billed_costs` rows whose invoice has a `credit_purchases` entry from period cost in `src/actions/budget.ts` — by exclusion, not by unpicking the link (C3)
- [ ] T039 [US4] Create pure `src/lib/credits.ts`: `deriveCreditBalance({ openingCents, openingAt, purchases, consumptionByDay })` returning `CreditBalance` with `available: false` when no opening balance is recorded (C5)
- [ ] T040 [P] [US4] Unit-test it in `tests/unit/credits.test.ts`: the C4 formula, events on/before/after the opening date, no opening balance → unavailable (never zero-derived), negative balance surfaced not clamped (C7), and J3 — recording or deleting a purchase changes no period cost
- [ ] T041 [US4] Update `src/components/claude/org-credits-panel.tsx`: show the derived balance with its as-of date and "derived by the Hub, not read from Anthropic"; keep the current message only when no opening balance is recorded
- [ ] T042 [P] [US4] Surface credit purchases as a distinct row on the budget/invoice views — a purchase, never a cost (C2)

**Checkpoint**: SC-006 verifiable — a top-up never raises the cost of the period it lands in.

## Phase 7: Reconciliation and recorded caps (US5, US7)

- [ ] T043 [US7] Create pure `src/lib/anthropic/reconciliation.ts`: `detectDivergence({ workspaceId, period, billedCents, attributedCents })` with the `max(500, billed * 0.05)` tolerance, returning both figures and the ratio
- [ ] T044 [P] [US7] Unit-test it in `tests/unit/anthropic/reconciliation.test.ts`: below/at/above tolerance, the small-absolute floor, zero billed with non-zero attributed, and a workspace with spend and no owners
- [ ] T045 [US7] Wire it into the cost sync, recording warning `sync_events` via the existing non-fatal `appendError` path
- [ ] T046 [P] [US7] Record a warning `sync_event` naming any model absent from the price table in `src/lib/sync/sources/anthropic-usage.ts`, replacing reliance on the `pricing_resolved` flag nobody reads
- [ ] T047 [P] [US7] Surface both warning kinds on the admin sync view in `src/app/settings/sync/`
- [ ] T048 [US5] Extend the workspace-limit admin action in `src/actions/anthropic-global.ts` to record `confirmed_at` / `confirmed_by` on every save
- [ ] T049 [US5] Workspace cap UI: consumption against the recorded cap, utilisation, last-confirmed date, threshold flagging, and the three distinct states — no cap recorded / recorded zero / recorded N (W1–W3)
- [ ] T050 [US5] Allowance-mismatch flag: compare the recorded cap against the sum of its owners' tier allowances and show both figures, neither authoritative (W4)
- [ ] T051 [P] [US5] State on every cap surface that the Hub does not enforce the limit — it mirrors a Console-set value (W5)

**Checkpoint**: SC-007 and SC-009 verifiable.

## Phase 8: Ownership admin and boost-\* deprecation (US8, US9)

- [ ] T052 [US8] Server actions in `src/actions/anthropic-global.ts` to list workspace ownership and set/clear a `manual` owner
- [ ] T053 [US8] Workspace list gains owner(s) and attribution mode plus the override action; unattributed workspaces shown with spend intact (FR-007)
- [ ] T054 [P] [US9] Exclude `deprecated_at IS NOT NULL` workspaces from the workspace list, cap views and cap aggregates, with a "show deprecated" toggle
- [ ] T055 [P] [US9] Skip deprecated workspaces in cap alerting in `src/actions/alerts.ts`
- [ ] T056 [US9] Verify historical months still include deprecated workspaces' spend (SC-010) — the exclusion is presentational only (I5)
- [ ] T057 [US9] Revoke the 36 assignments on pooled workspaces (Appendix A), scoped **by workspace, not by tier** (FR-029), carrying the agreed revocation date (spec OQ-3) rather than `now()`. Reuse the existing revoke path so change history is written (FR-030); do not write `license_assignments` directly
- [ ] T058 [US9] Confirm a budget period ending before the revocation date reports the same expected spend as before the revocation (US9 scenario 5) — `sumExpectedSpendCents` filters on the assignment window, so this is a regression check on the date, not on the code
- [ ] T059 [US9] Report assignment 262 (`boost-advanced`, workspace `Automations`, live spend) separately rather than revoking it (FR-029, spec OQ-4)

## Cross-cutting

- [ ] T060 Produce the restatement announcement covering **both** restatements: per-user monthly totals before/after for every restated month (phase 4), and expected-spend before/after per period (phase 5), with the reason for each. A deliverable, not a follow-up
- [ ] T061 [P] Update `CLAUDE.md` Recent Changes and the `docs/anthropic-cost-accuracy.md` pointer once the feature lands

## Dependencies

- Phase 1 blocks everything.
- Phase 2 → 3 → 4 in order (attribution needs line items; reads need stored attribution).
- Phase 5 depends on phase 3 (measured consumption comes from attribution) and should ship with or immediately after phase 4 (plan risk 1).
- Phase 6 depends on phase 5 (needs `pricing_model` to know which tools are prepaid).
- Phase 7 depends on phase 3 for divergence, on phase 1 only for caps.
- Phase 8 is independent of phases 2–7 and can ship any time after phase 1. **T054/T055 (boost-\* deprecation) are the earliest available visible win; T057 (revocation) needs only the agreed date.**

## Validation

- `pnpm lint` (zero warnings), `pnpm typecheck`, `pnpm test`, `pnpm test:integration`
- Manual: quickstart.md walkthrough
- SC-001: for a completed month, each single-owner user's Hub total versus the Console figure — 0 cents apart
- SC-004: a completed period's expected spend for seat tools unchanged to the cent; for usage tools within tolerance of measured consumption

## Appendix A: concrete identifiers

Captured 2026-09-18 from the live Hub. Re-verify before running the migration — an id list is a snapshot, not a query.

**Claude Console tool**: `ai_tools.id = 2`.

**Tiers to flip to `pricing_model = 'usage'`** (T008) — all five belong to tool 2:

| Tier id | Name           | Allowance |
| ------- | -------------- | --------- |
| 2       | boost-starter  | $25       |
| 3       | boost-advanced | $50       |
| 4       | boost-expert   | $100      |
| 10      | boost-leader   | $200      |
| 11      | indie-profile  | $125      |

Every other tier stays `seat` by the column default: Claude seats (5, 6), Cursor (7), Microsoft Copilot (9), GitHub Copilot (1, 8).

**Workspaces to deprecate** (T008) — 12 `boost-*` pools, by explicit `workspace_id`:

```text
wrkspc_01WwajmfNsthB13NXt2udGGN  boost-starter-1
wrkspc_01Gg5aVZTTQRpxGVkqhnF14m  boost-starter-2
wrkspc_01JSJ8QFMfB2EMssRL4WHo9z  boost-starter-3
wrkspc_01AJitrPisruy7LxCrkwQeBQ  boost-starter-4
wrkspc_01TJVdk6Bf21EK6pXgwjLE6p  boost-starter-5
wrkspc_01PmkV3C6HYFQKEjJ4twC7h1  boost-starter-6
wrkspc_01GjZw5w8bvftpTDN9ek6gf8  boost-starter-7
wrkspc_01JAZBuDF5xKqQt6gfhSN9YJ  boost-starter-8
wrkspc_01R7D66G5sKGfzxkujGskZ1S  boost-starter-9
wrkspc_01NTsZm2xviWx8D6LbwM7Ty8  boost-expert-1
wrkspc_01JLudCq2Fe5qHchBH1NQD6W  boost-expert-2
wrkspc_01CzBV9zdUWLrYN1KyTwBLhW  boost-expert-3
```

**Assignments to revoke** (T057) — 36, all on the pools above. Select them by the assignment's `workspace` value matching a deprecated pool, never by tier:

```text
13 14 15 16 17 20 21 23 24 25 26 27 28 30 31 33 34 35
158 159 162 170 177 178 179 180 183 186 193 194 195 196 260 266 287 288
```

**Not in that list** — assignment **262** (Tobias Studer, `boost-advanced`, workspace `Automations`). Boost tier, live workspace, current spend. Handled by T059, decided by spec OQ-4.

**Cross-check before running**: `ai_tools.id = 2` has 40 active assignments — 36 pooled (revoke), 3 `indie-profile` (Svenja 443, Marlon 407, Oliver 357 — keep), 1 exception (262). The three indie assignments are the users this feature exists to report on and must survive untouched.
