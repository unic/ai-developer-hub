# Implementation Plan: Usage-Based Cost Model

**Branch**: `045-usage-based-cost-model` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/045-usage-based-cost-model/spec.md`

## Summary

Correct the Hub's cost model for usage-based tools. One mistake shows up in three places, and all three are fixed together because fixing any one alone leaves a visible contradiction on screen.

1. **Per-user cost becomes billed cost.** The cost sync requests `cost_report` with `group_by[]=description` and stores line items (model, token type, context window, service tier, inference geo) in micro-cents instead of a daily total. A pure attribution module maps each workspace-day onto users — whole to the sole owner (`billed`), proportionally across several (`apportioned`), or to nobody (`unattributed`). Six read paths switch to `COALESCE(attributed_cost_cents, computed_cost_cents)` and report which method produced each figure.
2. **A tier price stops being a cost when it is an allowance.** `access_tiers` gains `pricing_model` (`seat` | `usage`, default `seat`). Expected spend for seat tiers is unchanged; for usage tiers it is measured consumption, projected from a trailing 3-month mean for open periods, falling back to the allowance only when there is no history. Every usage-tier figure is labelled by what it is.
3. **Credit purchases stop being period cost.** API access is prepaid; an invoice for a usage tool is recordable as a credit purchase, excluded from period cost, and the Hub derives a balance (opening + purchases − consumption) that the Anthropic API cannot supply.

Plus: recorded workspace caps mirrored from the Console with a last-confirmed date and an allowance-mismatch flag (tracking only — the Hub enforces nothing), sync-time reconciliation so a future divergence surfaces within a day, admin-correctable workspace ownership, and deprecation of the 12 dead `boost-*` workspaces.

The workspace-to-user mapping this rests on **already exists and is already populated** (`anthropic_sync_status.resolved_workspace_id`); the feature promotes it to a first-class, correctable relationship.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, Zod 4.3.6, shadcn/ui (new-york), TanStack Table 8.21.3, Recharts 2.15.4, Sonner
**Storage**: Neon PostgreSQL (serverless) — 3 new tables, 5 modified, 2 new enums; migration `0032`
**External API**: Anthropic Admin API `GET /v1/organizations/cost_report` (daily buckets only; `group_by[]=workspace_id`, `group_by[]=description`) and `usage_report/messages` (unchanged). **No** endpoint exists for spend limits or credit balance — both are admin-entered
**Testing**: Vitest unit tests for the pure attribution, expected-spend, credit and reconciliation modules; integration tests for the sync upsert path and the money invariants
**Target Platform**: Vercel (Fluid Compute); existing cron routes `/api/sync/anthropic-api-costs` and `/api/sync/anthropic-usage`
**Project Type**: Web application (single Next.js project)
**Performance Goals**: No additional Anthropic API calls — `group_by[]=description` rides the existing request. Cost sync within the current `maxDuration = 300`
**Constraints**: Profile API field compatibility (external contract); seat-based behaviour byte-identical; no destructive migration; no column renames; each phase independently deployable
**Scale/Scope**: ~23 workspaces, 40 API-key assignments, 4 active API users, ~1.1k line-item rows/month (measured from a live sample, not estimated). 4 new source modules, ~18 files touched

## Constitution Check

| Principle                       | Verdict | Notes                                                                                                                                                                                             |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Type-Safe Code Quality       | PASS    | Attribution, expected spend, credits and reconciliation land as pure, fully unit-tested modules; no `any`; `AttributionMethod`, `PricingModel` and `ExpectedSpendBasis` are shared exported types |
| II. UX Consistency              | PASS    | New affordances reuse existing primitives — badges for method and basis, shadcn tables for ownership and caps, Sonner for admin actions. Seat-based wording untouched                             |
| III. Performance Budgets        | PASS    | No extra external calls; line-item writes batched like the existing rollup; the daily rollup is preserved so the org dashboard's query cost is unchanged                                          |
| IV. Accessibility-First         | PASS    | Method, basis and cap states are conveyed in text, never by colour alone; three distinct cap states are worded, not shaded                                                                        |
| V. Simplicity & Maintainability | PASS    | Pure modules instead of logic scattered across query sites; the `COALESCE` read rule keeps each consumer a one-line change; no column renames (research.md D6)                                    |

**Monetary values**: integer cents end to end, including apportionment — remainders distributed by largest-remainder, never by floating-point division into a rounded result.

## Project Structure

### Documentation (this feature)

```text
specs/045-usage-based-cost-model/
├── spec.md                          # Feature specification
├── plan.md                          # This file
├── research.md                      # Phase 0 — D1–D13 with evidence
├── data-model.md                    # Phase 1 — schema and read models
├── quickstart.md                    # Phase 1 — how to exercise it locally
├── contracts/
│   ├── cost-attribution.md          # Attribution rules + API response contract
│   └── pricing-and-credits.md       # Pricing models, expected spend, credits, caps
├── checklists/
│   └── requirements.md              # Spec quality checklist
└── tasks.md                         # Phase 2 output
```

### Source (this feature)

```text
src/lib/
├── db/schema.ts                              # MODIFIED — 3 tables, 5 modifications, 2 enums
├── db/migrations/0032_*.sql                  # NEW
├── anthropic/
│   ├── cost-attribution.ts                   # NEW — pure: apportionment + mode derivation
│   ├── reconciliation.ts                     # NEW — pure: divergence detection
│   ├── queries.ts                            # MODIFIED — read rule
│   └── estimate-today.ts                     # UNCHANGED
├── expected-spend.ts                         # NEW — pure: per-tool expected spend by basis
├── credits.ts                                # NEW — pure: derived credit balance
├── budget-utils.ts                           # MODIFIED — sumExpectedSpendCents delegates
├── sync/sources/anthropic-workspace.ts       # MODIFIED — line items, ownership, reconcile
├── sync/sources/anthropic-usage.ts           # MODIFIED — unknown-model warning
├── anthropic-sync.ts                         # MODIFIED — maintain owners table
├── profile-data.ts                           # MODIFIED — read rule + method
└── mcp/data.ts                               # MODIFIED — read rule + method

src/actions/
├── anthropic-users.ts                        # MODIFIED — read rule
├── anthropic-global.ts                       # MODIFIED — ownership + cap admin actions
├── budget.ts                                 # MODIFIED — expected spend, credit exclusion
├── dashboard.ts                              # MODIFIED — read rule
├── reports.ts                                # MODIFIED — expected spend basis
├── tools.ts                                  # MODIFIED — pricing model on tier edit
└── credits.ts                                # NEW — record purchases + opening balance

src/app/                                      # MODIFIED — badges, labels, cap + credit panels
```

## Phases

Each phase is independently deployable and leaves the app correct. No phase requires the next one to ship.

### Phase 1 — Schema (foundational)

Migration `0032` plus the Drizzle schema: three tables, five modifications, two enums, the ownership seed, the five `Claude Console` tiers flipped to `usage`, the 12 `boost-*` workspaces deprecated. All additive; `pricing_model` defaults to `seat` so nothing changes on deploy.

Review with the `drizzle-migration-reviewer` agent — this is the only phase touching the database.

### Phase 2 — Line-item ingestion

`group_by[]=description` on `fetchCostReport()`; write line items; derive the existing daily rollup from them; backfill through the existing month loop. Every existing surface still reads the rollup unchanged.

### Phase 3 — Attribution

Pure `cost-attribution.ts` (mode derivation, largest-remainder apportionment) and a sync step writing `attributed_cost_cents` / `attribution_mode`. Nothing reads them yet. All the real logic, testable without a database.

### Phase 4 — Read-path swap and attribution labelling

Six consumers switch to the `COALESCE` read rule and surface `method`. Profile API and MCP responses gain fields; no existing field changes name or meaning. **Per-user history restates here** — ships with the announcement.

### Phase 5 — Pricing models and expected spend

Pure `expected-spend.ts`; `sumExpectedSpendCents` delegates to it; budget, reports and dashboard consume `ExpectedSpend` with its basis; allowance labelling lands across the tools, assignments, user and licence surfaces. **Expected spend restates here** — the second half of the same announcement.

### Phase 6 — Credit purchases and balance

Record a purchase against an invoice; exclude those `billed_costs` rows from period cost; opening balance on the tool; pure `credits.ts`; the credits panel stops saying the balance is unavailable from Anthropic and shows the derived figure with its as-of date.

### Phase 7 — Reconciliation and recorded caps

`reconciliation.ts` plus warning sync events for divergence and unknown models. Recorded workspace caps gain `confirmed_at` / `confirmed_by`, utilisation, threshold flagging, and the allowance-mismatch flag — all marked as non-enforcing.

### Phase 8 — Ownership admin and boost-\* deprecation

Workspace list gains owners, attribution mode and a manual override. Deprecated workspaces drop out of listings, cap aggregates and alerting.

## Risks

| #   | Risk                                                                                                                                                                                   | Mitigation                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Two restatements land close together.** Per-user history (phase 4) and expected spend (phase 5) both move; saved forecast scenarios (041), budget periods and reports move with them | One announcement covering both, with before/after per user and per period. Phases 4 and 5 ship together or in quick succession, never with a long gap that invites two rounds of questions |
| 2   | **Apportionment rounding doesn't sum to the billed total**                                                                                                                             | Largest-remainder with an explicit test asserting exact summation across adversarial splits (three owners, 1-cent totals, zero-weight owners)                                              |
| 3   | **A user's key stops resolving** and their workspace silently becomes `unattributed`, zeroing their cost                                                                               | Reconciliation treats a workspace with spend and no owner as a warning. Never report a zero where the previous period had spend without a warning                                          |
| 4   | **A usage tool's expected spend collapses to near-zero** for a genuinely new assignment before any consumption exists                                                                  | `allowance_fallback` basis, surfaced as a placeholder rather than a measurement (P7)                                                                                                       |
| 5   | **The derived credit balance is wrong** because a top-up was never recorded or the opening balance is stale                                                                            | Balance always carries its as-of date and "derived by the Hub"; a negative balance is shown, not clamped (C7), because that is the signal something is missing                             |
| 6   | **A recorded cap drifts from the Console**                                                                                                                                             | `confirmed_at` shown wherever the cap is shown; the Hub never claims to know the live value                                                                                                |
| 7   | ~~**`group_by[]=description` pushes the sync past `maxDuration`**~~ — measured against a live sample at ~36–38 rows/day org-wide (~1.1k/month); risk closed                            | Chunked upserts as today; the backfill already loops month-by-month. Still confirm wall-clock on the first real backfill                                                                   |
| 8   | **Two sources of truth during phases 2–3**                                                                                                                                             | The rollup is _derived_ from line items, never written independently                                                                                                                       |
| 9   | **Cost-report history unavailable for older months**                                                                                                                                   | Those months keep computed figures, marked `estimated`. Restatement is best-effort by design (FR-026)                                                                                      |
| 10  | **Deprecation hides spend** if a `boost-*` workspace is revived                                                                                                                        | Deprecation excludes from listings and alerting, never from cost totals; new spend on a deprecated workspace is a reconciliation warning                                                   |

## Out of Scope

- Attributing project/client workspace spend (~46% of September) to cost centres, projects or clients — deferred to a separate feature by explicit decision. Such spend stays visible as unattributed.
- Enforcing allowances or caps. The Hub tracks; the Console enforces. No Admin API endpoint exists for either.
- Revoking the 37 `Claude Console` assignments on pooled workspaces (spec OQ-1).
- Renaming `monthly_cost_cents` / `cost_at_assignment_cents` (research.md D6).
- Any change to GitHub Copilot cost handling, beyond its tiers defaulting to `seat`.
