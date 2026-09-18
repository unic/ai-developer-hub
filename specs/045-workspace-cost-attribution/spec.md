# Feature Specification: Workspace-Based Claude Cost Attribution

**Feature Branch**: `045-workspace-cost-attribution`
**Created**: 2026-09-18
**Status**: Draft
**Input**: User description: "When we started this application to track costs, most developers were on an API key. Since then we switched the design, and most people are now on a subscription. The developers that keep the API key are now usually having their own workspace. Redesign the application so that it supports a workspace per user and better price calculation. The outdated boost-\* workspaces can be deprecated. Costs that are not attributable to a person (project or client workspaces) are out of scope and will be addressed separately."

## Context

The Hub carries two independent Claude cost figures:

| Figure            | Source                                                                                     | Stored in                                     | Consumed by                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| **Billed cost**   | Anthropic `GET /v1/organizations/cost_report`                                              | `anthropic_workspace_costs`                   | `/claude` org dashboard, workspace pages, budget caps                         |
| **Computed cost** | `usage_report` token counts × the hard-coded price table in `src/lib/anthropic-pricing.ts` | `anthropic_usage_metrics.computed_cost_cents` | Per-user pages, the profile API, and the MCP tools other applications consume |

Only the first is authoritative. The second is an estimate, and in August–September 2026 it drifted badly: every model released after the price table was last updated fell back to the highest tier ever charged ($15/$75 per MTok), overstating one user's spend by **7.59×**. The immediate fix (docs/anthropic-cost-accuracy.md) restored the price table, but left the architecture that produced the failure intact — the Hub still re-derives a number Anthropic already bills exactly.

Three facts about the estate make a structural fix worthwhile now:

1. **The estate inverted.** ≥172 users hold Claude subscription seats; 40 hold `Claude Console` (API key) assignments. Only **4 users had any API usage in September 2026**.
2. **The remaining API users each own a workspace.** The live API users sit in dedicated `Indie - <Name>` workspaces (5 provisioned, 3 with September spend). Where a workspace has exactly one owner, its billed cost **is** that person's cost — no estimation required.
3. **The pooled model is dead.** 12 `boost-*` workspaces carry ~$4,700/month of configured caps and **$0.00 of actual spend**. They are the fossil of the shared-key era and should be deprecated.

This feature makes billed cost the source of truth for per-user reporting wherever a workspace has a single owner, keeps the token-derived estimate only where it is genuinely needed, and retires the pooled-workspace structure.

**Explicitly out of scope**: attributing spend in project/client workspaces (`AI Code Review Trial`, `Jungfraubahnen`, `Automations`, `Ensinger Plastics` — ~46% of September spend) to cost centres, projects or clients. That needs a concept the Hub does not have yet and is deferred to a separate feature. This feature must leave that spend visible and clearly labelled as unattributed, not silently drop or misattribute it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Per-user cost matches the Claude Console (Priority: P1)

A developer with their own Anthropic workspace opens their Hub profile, or an external application reads their cost through the profile API. The monthly figure they see is the amount Anthropic actually billed for that workspace — the same number the Claude Console shows — not a re-derived estimate.

**Why this priority**: This is the defect the feature exists to close. Every other story is refinement around making this number correct, explicable and durable.

**Independent Test**: For each user whose resolved workspace has exactly one owner, compare the Hub's monthly total against `anthropic_workspace_costs` for that workspace and month. They must be equal to the cent for every complete day.

**Acceptance Scenarios**:

1. **Given** a user whose API key resolves to a workspace they solely own, **When** their monthly cost is read from the profile API, the MCP `get_user_cost_profile` tool, or the Hub user page, **Then** the figure equals the sum of billed daily costs for that workspace over the same date range.
2. **Given** the same user, **When** a model the Hub has never seen is used, **Then** their reported cost is still exact, because no price table is consulted for complete days.
3. **Given** a user whose workspace has more than one owner, **When** their cost is read, **Then** the figure is the workspace's billed total apportioned by that user's token share, and the response marks it as apportioned rather than billed.
4. **Given** any user, **When** a cost figure is returned, **Then** the response states which attribution method produced it.

---

### User Story 2 - Today's spend stays visible and honest (Priority: P2)

An admin watching the `/claude` dashboard mid-morning still sees a current-day figure, clearly marked as an estimate, because Anthropic's cost API reports complete UTC days only.

**Why this priority**: Switching to billed cost must not regress the intraday visibility the Hub already has — that was the original reason for computing costs locally, and it remains valid for today only.

**Independent Test**: With the cost sync having no bucket for today, confirm every surface that shows month-to-date still shows a today component, labelled as an estimate, and that it disappears (rather than showing zero) once the sync has no per-user data to base it on.

**Acceptance Scenarios**:

1. **Given** the cost report has no bucket for the current UTC day, **When** month-to-date is displayed, **Then** it is presented as billed-to-date plus a separately labelled today estimate.
2. **Given** the current day completes and the next sync runs, **When** the same month-to-date is read again, **Then** the estimate for that day is replaced by the billed figure without double counting.
3. **Given** a user with no usage today, **When** their profile is read, **Then** no today estimate is shown rather than an estimate of zero.

---

### User Story 3 - Divergence surfaces within a day (Priority: P2)

When the Hub's estimate and Anthropic's billing disagree beyond a tolerance — a new model, a pricing change, a broken key mapping — an admin learns about it from the Hub, not from a spot check months later.

**Why this priority**: The original bug ran for over a month undetected. Making the estimate exact where possible does not remove the estimate entirely, so the remaining estimate needs a watchdog.

**Independent Test**: Seed a workspace whose billed total differs from the sum of its users' computed costs by more than the tolerance, run the sync, and confirm a warning-level sync event is recorded naming the workspace, the month and both figures.

**Acceptance Scenarios**:

1. **Given** a complete day where a workspace's billed cost and its attributed computed cost differ by more than the configured tolerance, **When** the cost sync runs, **Then** a sync event records the discrepancy with both figures and the workspace.
2. **Given** a usage row whose model is not in the price table, **When** the usage sync runs, **Then** a sync event names the unrecognised model.
3. **Given** no discrepancy beyond tolerance, **When** the sync runs, **Then** no warning event is produced.

---

### User Story 4 - Workspace ownership is visible and correctable (Priority: P3)

An admin can see which workspace each API-key holder maps to, whether that workspace has one owner or several, and can correct a mapping the automatic resolution got wrong.

**Why this priority**: Attribution correctness now depends on ownership being right, so ownership must stop being an invisible by-product of key resolution.

**Independent Test**: Open the workspace admin view and confirm every workspace shows its owner(s) and an attribution mode; change an assignment and confirm subsequent cost reads follow the new mapping.

**Acceptance Scenarios**:

1. **Given** the workspace list, **When** an admin views it, **Then** each workspace shows its owning user(s), the attribution mode in effect, and current-month billed spend.
2. **Given** a workspace with no resolved owner, **When** an admin views it, **Then** it is shown as unattributed with its spend intact.
3. **Given** an admin corrects an owner mapping, **When** per-user costs are next read, **Then** they reflect the corrected mapping without a re-sync of Anthropic data.

---

### User Story 5 - The pooled boost-\* structure is retired (Priority: P3)

The 12 `boost-*` workspaces, their caps and their assignments no longer clutter the workspace list, budget figures or alerting, and the numbers they used to inflate come down to reality.

**Why this priority**: Independent of attribution, but it is the same cleanup and the same reviewer. Leaving it makes the corrected views harder to read.

**Independent Test**: After deprecation, confirm the workspace list and budget surfaces exclude the pooled workspaces by default, that their historical cost rows are still readable, and that no alert can fire against a deprecated workspace.

**Acceptance Scenarios**:

1. **Given** a workspace marked deprecated, **When** the workspace list or cap-utilisation view is rendered, **Then** it is excluded by default and reachable through an explicit "show deprecated" affordance.
2. **Given** a deprecated workspace with historical cost rows, **When** a past month is reported, **Then** its historical spend is still included in that month's totals.
3. **Given** a deprecated workspace, **When** cap alerting evaluates, **Then** it is skipped and its configured cap is excluded from any aggregate of configured caps.

---

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST store Anthropic billed cost at line-item granularity (workspace, date, model, token type, context window, service tier) rather than a single daily total per workspace.
- **FR-002**: The system MUST record, per workspace, the set of Hub users whose resolved API keys belong to it, and derive from that an attribution mode: `billed` (exactly one owner), `apportioned` (more than one owner), or `unattributed` (none).
- **FR-003**: For a workspace in `billed` mode, per-user cost for complete days MUST equal the workspace's billed cost for those days, without consulting the price table.
- **FR-004**: For a workspace in `apportioned` mode, per-user cost for complete days MUST be the workspace's billed cost distributed across its owners in proportion to each owner's computed cost for the same day, with rounding remainders assigned deterministically so the parts sum exactly to the billed total.
- **FR-005**: For the current (incomplete) UTC day, per-user cost MUST continue to come from the token-derived estimate.
- **FR-006**: Every cost figure returned by an API, MCP tool or UI surface MUST carry the attribution method that produced it (`billed`, `apportioned`, or `estimated`) and MUST NOT present an estimate as a billed figure.
- **FR-007**: The system MUST NOT attribute spend from a workspace with no resolved owner to any user; such spend MUST remain visible in org-level totals labelled as unattributed.
- **FR-008**: The cost sync MUST compare each workspace's billed cost against the attributed computed cost for the same complete days and record a warning sync event when they diverge beyond a configurable tolerance.
- **FR-009**: The usage sync MUST record a warning sync event when it encounters a model absent from the price table.
- **FR-010**: Administrators MUST be able to view and correct the workspace-to-user mapping, and corrections MUST take effect on the next cost read without requiring a re-sync of Anthropic data.
- **FR-011**: Workspaces MUST be markable as deprecated; deprecated workspaces MUST be excluded by default from workspace listings, cap-utilisation views and cap alerting, while their historical cost data remains readable and included in historical totals.
- **FR-012**: The profile API and MCP tool responses MUST remain backward compatible: existing fields keep their names and meaning, attribution information is added alongside them.
- **FR-013**: Historical per-user figures MUST be restated to billed cost for all months for which cost-report data can be retrieved, and the restatement MUST be recorded so that a changed historical number can be explained.
- **FR-014**: The token-derived computation and the price table MUST be retained — they remain the input to apportionment, the current-day estimate, and the divergence check.

### Key Entities

- **Workspace cost line item** — one billed amount for a workspace on a date, at model / token-type / context-window / service-tier granularity. Sourced from `cost_report` grouped by workspace and description. Replaces the single-total-per-day row as the storage grain.
- **Workspace ownership** — the relationship between an Anthropic workspace and the Hub users whose API keys resolve into it, plus an admin override. Determines attribution mode.
- **Attributed daily cost** — the per-user, per-day figure the Hub reports, carrying its attribution method.
- **Reconciliation event** — a recorded comparison of billed versus computed cost for a workspace and period, with the outcome.

## Success Criteria _(mandatory)_

- **SC-001**: For every user in a single-owner workspace, the Hub's monthly cost for a completed month equals the Claude Console figure for that workspace exactly (0 cents difference).
- **SC-002**: A model released after the last price-table update changes no user's reported cost for any complete day.
- **SC-003**: Every cost figure exposed by the profile API, the MCP tools and the Hub UI states its attribution method.
- **SC-004**: A divergence beyond tolerance between billed and computed cost is visible to an admin within one sync cycle of the day it occurs.
- **SC-005**: Month-to-date cost remains available intraday, with the estimated portion of it separately identifiable.
- **SC-006**: Deprecated workspaces contribute nothing to configured-cap aggregates or cap alerting, and their historical spend still appears in historical months.
- **SC-007**: Spend in workspaces with no owner is reported at org level and attributed to no user.
- **SC-008**: Existing consumers of the profile API continue to work without changes to the fields they already read.

## Assumptions

- `cost_report` remains daily-granularity only (`bucket_width=1d`) and continues to exclude the current UTC day; cost and usage data both appear within ~5 minutes of request completion.
- `cost_report` cannot attribute cost below workspace level — there is no `api_key_id` grouping — so multi-owner workspaces inherently require apportionment.
- A workspace's cost-report history remains retrievable for the months the Hub needs to restate; where it is not, those months keep their existing computed figures and are marked as such.
- Every API-key holder who will be reported on individually either already has, or will be moved to, their own workspace. Users remaining in a shared workspace are reported through apportionment and are accepted as approximate.
- Tier prices (e.g. `indie-profile` at $125/month) are budget allowances, not costs. Whether the licence register should continue to report them as monthly cost is **a separate decision, not settled by this feature** — it is recorded as an open question below.

## Open Questions

- **OQ-1**: The licence register books $3,650/month for `Claude Console` assignments against ~$322/month of actual September spend. Should a tier price be reported as an allowance rather than a cost? This feature does not change that behaviour; it only makes the actual-spend side correct, which will make the gap more visible.
- **OQ-2**: Should the 37 `Claude Console` assignments on deprecated pooled workspaces be revoked, or left active with a corrected cost basis? Deprecating the workspaces does not by itself revoke the assignments.
