# Specification Quality Checklist: Usage-Based Cost Model

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-18
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified — multi-owner workspaces, zero-weight apportionment, workspaces with no owner, usage assignments with no history, missing opening credit balance, negative credit balance, no cap recorded versus a recorded cap of zero, unavailable cost-report history, the current-day boundary
- [x] Scope is clearly bounded — project/client attribution deferred; enforcement excluded by design
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Decisions Taken

Resolved during specification, recorded here so they are not re-litigated:

- **Tier price for a usage tier is an allowance, not a cost** — expected spend uses measured consumption, with labelling that names allowance, consumption, purchase and balance separately (US2, US3).
- **The Hub tracks, it does not enforce.** Budget caps are set in the Claude Console; the Admin API exposes no endpoint for spend limits or credit balance. Recorded caps are mirrors with a last-confirmed date (US5, research.md D10).
- **API invoices are credit purchases, not period cost.** Consumption is the cost; top-ups are cash on unrelated dates (US4, research.md D9).
- **The `boost-*` pooled workspaces are deprecated**, not deleted — their historical spend stays in historical months (US9).
- **Project/client workspace attribution is deferred** to a separate feature; that spend stays visible as unattributed.

## Notes

No open questions remain. All four were resolved on 2026-09-18 and are recorded here so they are not re-litigated:

- **OQ-1** — the 37 `Claude Console` assignments on the deprecated pooled workspaces **are** revoked. They were already deactivated in the Claude Console, so the Hub was carrying licences that no longer exist. See US9, FR-028 and T057.
- **OQ-2** — the projection window for a usage tier's expected spend in open periods is a **trailing mean of the 3 most recent complete months**. A constant in one pure function (contracts/pricing-and-credits.md P5).
- **OQ-3** — the revocation date is **2026-07-01**, matching the collapse in org-wide Claude API spend from $3,016.86 (June) to $194.89 (July).
- **OQ-4** — assignment 262 (`boost-advanced`, `Automations` workspace) is revoked on the same date; its workspace keeps its spend, reported as `unattributed`.
