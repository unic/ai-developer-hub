# Implementation Plan: Workspace-Based Claude Cost Attribution

**Branch**: `045-workspace-cost-attribution` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/045-workspace-cost-attribution/spec.md`

## Summary

Make Anthropic's billed cost the source of truth for per-user Claude reporting. The cost sync starts requesting `cost_report` with `group_by[]=description`, storing line items (model, token type, context window, service tier) instead of a single daily total. A new pure attribution module maps each workspace-day's billed cost onto users: whole to the sole owner (`billed`), proportionally across several owners (`apportioned`), or to nobody (`unattributed`). The six read paths that today sum `computed_cost_cents` switch to `COALESCE(attributed_cost_cents, computed_cost_cents)` and report which method produced the figure. The token computation and price table stay — as apportionment weights, as the current-day estimate, and as the input to a new reconciliation check that warns when the two sources disagree. The 12 dead `boost-*` workspaces are marked deprecated.

The workspace-to-user mapping this depends on **already exists and is already populated** (`anthropic_sync_status.resolved_workspace_id`); this feature promotes it to a first-class, admin-correctable relationship.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, shadcn/ui (new-york), TanStack Table 8.21.3, Sonner
**Storage**: Neon PostgreSQL (serverless) — 2 new tables, 3 modified tables, 1 new enum; migration `0032`
**External API**: Anthropic Admin API `GET /v1/organizations/cost_report` (daily buckets only; `group_by[]=workspace_id`, `group_by[]=description`) and `usage_report/messages` (unchanged)
**Testing**: Vitest unit tests for the pure attribution and reconciliation modules; integration tests for the sync upsert path
**Target Platform**: Vercel (Fluid Compute); existing cron routes `/api/sync/anthropic-api-costs` and `/api/sync/anthropic-usage`
**Project Type**: Web application (single Next.js project)
**Performance Goals**: No additional Anthropic API calls — `group_by[]=description` rides the existing request. Cost sync runtime within the current `maxDuration = 300`
**Constraints**: Profile API field compatibility (documented external contract); no destructive migration; each phase independently deployable
**Scale/Scope**: ~20 workspaces, ~40 API-key assignments, 4 active users; ~12k line-item rows/month. 2 new source modules, ~10 files touched

## Constitution Check

| Principle                       | Verdict | Notes                                                                                                                                                              |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Type-Safe Code Quality       | PASS    | Attribution and reconciliation land as pure, fully unit-tested modules; no `any`; `AttributionMethod` is a shared exported type                                    |
| II. UX Consistency              | PASS    | New affordances reuse existing primitives — badge for attribution method, shadcn table for workspace ownership, Sonner for admin actions                           |
| III. Performance Budgets        | PASS    | No extra external calls; line-item writes are batched like the existing rollup; the daily rollup table is preserved so the org dashboard's query cost is unchanged |
| IV. Accessibility-First         | PASS    | Attribution method must not be conveyed by colour alone — badge carries text; ownership table is a standard data table                                             |
| V. Simplicity & Maintainability | PASS    | Two new modules rather than attribution logic scattered across six query sites; the `COALESCE` read rule keeps each consumer a one-line change                     |

**Monetary values**: all costs stay integer cents end to end, including apportionment — remainders are distributed by largest-remainder, never by floating-point division into a rounded result.

## Project Structure

### Documentation (this feature)

```text
specs/045-workspace-cost-attribution/
├── spec.md                      # Feature specification
├── plan.md                      # This file
├── research.md                  # Phase 0 — decisions & evidence
├── data-model.md                # Phase 1 — schema and read model
├── quickstart.md                # Phase 1 — how to exercise it locally
├── contracts/
│   └── cost-attribution.md      # Attribution rules + API/MCP response contract
├── checklists/
│   └── requirements.md          # Spec quality checklist
└── tasks.md                     # Phase 2 output
```

### Source (this feature)

```text
src/lib/
├── db/schema.ts                              # MODIFIED — 2 tables, 3 modifications, 1 enum
├── db/migrations/0032_*.sql                  # NEW
├── anthropic/
│   ├── cost-attribution.ts                   # NEW — pure: apportionment + mode derivation
│   ├── reconciliation.ts                     # NEW — pure: divergence detection
│   ├── queries.ts                            # MODIFIED — read rule
│   └── estimate-today.ts                     # UNCHANGED
├── sync/sources/anthropic-workspace.ts       # MODIFIED — line items, ownership, reconcile
├── sync/sources/anthropic-usage.ts           # MODIFIED — unknown-model warning
├── anthropic-sync.ts                         # MODIFIED — maintain owners table
├── profile-data.ts                           # MODIFIED — read rule + method
└── mcp/data.ts                               # MODIFIED — read rule + method

src/actions/
├── anthropic-users.ts                        # MODIFIED — read rule
├── anthropic-global.ts                       # MODIFIED — ownership admin actions
└── dashboard.ts                              # MODIFIED — read rule

src/app/claude/                               # MODIFIED — attribution badge, ownership view
```

## Phases

Each phase is independently deployable and leaves the app correct. No phase requires the next one to ship.

### Phase 1 — Schema (foundational)

Migration `0032` plus the Drizzle schema. All additive, all nullable. Seed `anthropic_workspace_owners` from existing sync status. Nothing reads the new columns yet; behaviour is unchanged on deploy.

Run through the `drizzle-migration-reviewer` agent before applying — this is the only phase that touches the database.

### Phase 2 — Line-item ingestion

Add `group_by[]=description` to `fetchCostReport()`, widen the Zod schema (the fields are _already_ declared in `costReportResultSchema` and simply discarded today), write line items, and derive the existing daily rollup from them. Backfill historical months through the existing month-loop backfill path.

At the end of this phase the Hub holds billed cost at full granularity and every existing surface still reads the rollup exactly as before.

### Phase 3 — Attribution

Pure module `cost-attribution.ts`: derive mode from owner count, apportion by computed-cost share with largest-remainder rounding, emit `AttributedDailyCost[]`. A sync step writes `attributed_cost_cents` / `attribution_mode` back onto `anthropic_usage_metrics`. Still nothing reads them.

This is the phase with the real logic and it is entirely testable without a database.

### Phase 4 — Read-path swap (the user-visible change)

Switch the six consumers to `COALESCE(attributed_cost_cents, computed_cost_cents)` and surface `method`. Profile API and MCP responses gain fields; no existing field changes name or meaning. **This is the phase where historical numbers restate** — it ships with the announcement, not before it.

### Phase 5 — Reconciliation & unknown-model warnings

`reconciliation.ts` compares billed against attributed-computed per workspace-month; the cost sync records a warning `sync_event` beyond tolerance. The usage sync warns on models absent from the price table. Admin sync view surfaces both.

### Phase 6 — Ownership admin & boost-\* deprecation

Workspace list gains owner(s), attribution mode and a manual override action. Deprecated workspaces drop out of listings, cap aggregates and alerting by default. Mark the 12 `boost-*` workspaces deprecated.

## Risks

| #   | Risk                                                                                                                                                               | Mitigation                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Historical restatement surprises people.** Oliver's August drops from $174.94 to $19.30; saved forecast scenarios (041), budget periods and reports move with it | Phase 4 ships with a written announcement and a before/after table per affected user. Restatement is recorded so a changed number can be explained                              |
| 2   | **Apportionment rounding doesn't sum to the billed total**                                                                                                         | Largest-remainder distribution with an explicit unit test asserting exact summation across adversarial splits (three owners, 1-cent totals, zero-weight owners)                 |
| 3   | **A user's key stops resolving** and their workspace silently becomes `unattributed`, zeroing their cost                                                           | Reconciliation (phase 5) treats a workspace with spend and no owner as a warning, not a silent state. Never report a zero where the previous period had spend without a warning |
| 4   | **`group_by[]=description` changes response volume** enough to push the sync past `maxDuration`                                                                    | Line items are batched with the same chunked upsert the rollup uses; the backfill already loops month-by-month. Measure on the first backfill before enabling in cron           |
| 5   | **Two sources of truth during phases 2–3**                                                                                                                         | The rollup is _derived_ from line items, not written independently, so they cannot disagree                                                                                     |
| 6   | **Cost-report history unavailable for older months**                                                                                                               | Those months keep their computed figures, marked `estimated`. Restatement is best-effort by design (FR-013)                                                                     |
| 7   | **Deprecation hides spend** if a `boost-*` workspace is revived                                                                                                    | Deprecation excludes from _listings and alerting_, never from cost totals. A deprecated workspace that records new spend is a reconciliation warning                            |

## Out of Scope

- Attributing project/client workspace spend (~46% of September) to cost centres, projects or clients — deferred to a separate feature by explicit decision.
- Changing whether tier prices are reported as cost or allowance (spec OQ-1).
- Revoking the 37 `Claude Console` assignments on pooled workspaces (spec OQ-2) — deprecating a workspace does not revoke assignments.
- Any change to GitHub Copilot cost handling.
