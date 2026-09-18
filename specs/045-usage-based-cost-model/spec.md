# Feature Specification: Usage-Based Cost Model

**Feature Branch**: `045-usage-based-cost-model`
**Created**: 2026-09-18
**Status**: Draft
**Input**: User description: "When we started this application to track costs, most developers were on an API key. Since then we switched the design, and most people are now on a subscription. The developers that keep the API key are now usually having their own workspace. Redesign the application so that it supports a workspace per user and better price calculation. The outdated boost-\* workspaces can be deprecated. Costs that are not attributable to a person (project or client workspaces) are out of scope and will be addressed separately. A tier price for an API tool is an allowance, not a cost — expected spend should use measured actuals, and the labelling should say which is which. Also track the workspace limits. Note: the allowance is not enforced by this tool; budget caps are set in the Claude Console directly. This tool is only for tracking."

## Context

The Hub was built when most developers held Anthropic API keys in shared pooled workspaces. That world is gone:

- **≥172** users now hold Claude subscription **seats**; **40** hold `Claude Console` (API key) assignments.
- Only **4 users had any API usage** in September 2026, and each sits in their own `Indie - <Name>` workspace.
- The **12 `boost-*` pooled workspaces** carry ~$4,700/month of configured caps and **$0.00** of spend. They are a fossil.

The cost model never followed. It is wrong in three independent ways, and this feature fixes all three as one change because they are the same mistake seen from three angles: **the Hub models a usage-based tool as if it were a seat.**

### 1. Per-user cost is re-derived instead of read

Per-user cost comes from `usage_report` token counts multiplied by a hard-coded price table. In August–September 2026 every model released after the table was last updated fell back to the highest tier ever charged, overstating one user's spend **7.59×**. The price-table fix (docs/anthropic-cost-accuracy.md) restored accuracy but left the architecture: the Hub still re-derives a number Anthropic bills exactly, and where a workspace has a single owner that re-derivation is pure loss.

### 2. A tier price is treated as a cost even when it is an allowance

`sumExpectedSpendCents()` sums `costAtAssignmentCents` for every active assignment, regardless of tool kind. For a **seat** that is right — you pay per seat per month whether or not it is used. For **API access** it is wrong: the $125 `indie-profile` price is an _allowance_ (how much that person may spend), not a prediction of spend.

The effect on the budget's expected line, September 2026:

| Line                                                | Amount      |
| --------------------------------------------------- | ----------- |
| `planned` (budget plan)                             | $17,775     |
| `expected` (Σ tier prices)                          | $14,858     |
| of which Claude Console tiers                       | **$3,650**  |
| actual Claude API consumption (Aug, complete month) | **$398.69** |

Roughly **$3,250/month** of phantom expected spend — about half the gap between expected ($14,797) and actual ($8,557) in August.

### 3. Credit purchases are recorded as if they were consumption

Anthropic API access is **prepaid**: the organisation buys a dollar amount of credits, consumption draws it down, and a bill arrives when the balance is topped up. The Hub links those invoices into `billed_costs` as period spend, so a top-up inflates the month it lands in and leaves the following months looking free. Consumption and cash-out are different events on different dates and the Hub currently conflates them.

(Seat invoices behave normally — the large monthly invoice, plus small ones when seats are added or upgraded mid-month.)

### What this feature is not

- It does **not** enforce anything. Budget caps are set in the Claude Console directly; the Anthropic Admin API exposes no endpoint for reading or setting spend limits or credit balance. The Hub records what an admin tells it and reports against it. **Tracking only.**
- It does **not** attribute project/client workspace spend (`AI Code Review Trial`, `Jungfraubahnen`, `Automations`, `Ensinger Plastics` — ~46% of September spend) to cost centres, projects or clients. That needs a concept the Hub lacks and is deferred by explicit decision. Such spend must stay visible and labelled as unattributed, never dropped or misattributed.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Per-user cost matches the Claude Console (Priority: P1)

A developer with their own Anthropic workspace opens their Hub profile, or an external application reads their cost through the profile API. The monthly figure is the amount Anthropic actually billed for that workspace — the same number the Console shows — not a re-derived estimate.

**Why this priority**: the defect the feature exists to close; everything else refines around it.

**Independent Test**: for each user whose workspace has exactly one owner, compare the Hub's monthly total against the workspace's billed cost for the same month. Equal to the cent for every complete day.

**Acceptance Scenarios**:

1. **Given** a user whose API key resolves to a workspace they solely own, **When** their monthly cost is read from the profile API, the MCP `get_user_cost_profile` tool, or the Hub user page, **Then** the figure equals the sum of billed daily costs for that workspace over the same range.
2. **Given** the same user, **When** a model the Hub has never seen is used, **Then** their reported cost is still exact, because no price table is consulted for complete days.
3. **Given** a user whose workspace has more than one owner, **When** their cost is read, **Then** the figure is the workspace's billed total apportioned by that user's share, marked as apportioned rather than billed.
4. **Given** any user, **When** a cost figure is returned, **Then** the response states which method produced it.

---

### User Story 2 - Expected spend reflects what usage-based tools actually cost (Priority: P1)

A budget owner opens the budget page. The expected-spend line for API tools is based on what those tools have actually been consuming, not on the sum of allowances nobody spends.

**Why this priority**: the forecast is what people decide against. An expected line that is ~10× reality on the API portfolio devalues the whole budget page, and after US1 lands the contradiction becomes visible on screen.

**Independent Test**: mark the `Claude Console` tiers as usage-based, recompute a completed period, and confirm its expected figure moves from the sum of allowances toward measured consumption, while seat-based tools are unchanged to the cent.

**Acceptance Scenarios**:

1. **Given** a tool whose tiers are seat-based, **When** expected spend is computed for any period, **Then** it is the sum of tier prices exactly as before this feature.
2. **Given** a tool whose tiers are usage-based, **When** expected spend is computed for a completed period, **Then** it is the measured consumption for that period, not the sum of allowances.
3. **Given** a usage-based tool, **When** expected spend is computed for the current or a future period, **Then** it is projected from recent measured consumption.
4. **Given** a usage-based assignment with no consumption history, **When** expected spend is computed, **Then** the allowance is used as the fallback and the figure is marked as such.
5. **Given** any expected-spend figure, **When** it is displayed, **Then** the basis (tier price / measured / projected / allowance fallback) is stated.

---

### User Story 3 - Allowance and cost are never confused in the UI (Priority: P1)

Anyone reading a tier price, a licence assignment or a cost figure can tell at a glance whether they are looking at an allowance someone was granted, a measured cost, or money that has left the company.

**Why this priority**: this is what makes US2 legible. Three different numbers for the same tool on the same page is only confusing if they are not named.

**Independent Test**: on the tools, assignments, user and budget pages, confirm every money figure for a usage-based tool carries a basis label, and that no seat-based figure is relabelled.

**Acceptance Scenarios**:

1. **Given** a usage-based tier, **When** its price is shown anywhere (tool detail, assignment dialogs, user detail, licence register), **Then** it is labelled as a monthly allowance, not a monthly cost.
2. **Given** a seat-based tier, **When** its price is shown, **Then** the wording is unchanged from before this feature.
3. **Given** a usage-based tool on the budget or dashboard, **When** its money figures are shown, **Then** allowance, measured consumption and credit purchases are visually distinct and individually labelled.

---

### User Story 4 - Credit purchases are tracked as cash, not as monthly cost (Priority: P2)

A finance-minded admin can see how much has been _spent_ on API consumption each month, how much has been _paid_ in credit top-ups, and roughly how much credit is left — without the two being added together.

**Why this priority**: without it, US2's corrected expected line still sits next to a billed line that spikes on top-up months. It also gives the Hub something the Console API does not expose at all.

**Independent Test**: record an opening credit balance and date, let a top-up invoice and a month of consumption land, and confirm the month's cost equals consumption, the top-up appears as a purchase not a cost, and the derived balance equals opening + purchases − consumption.

**Acceptance Scenarios**:

1. **Given** an invoice for a usage-based tool marked as a credit purchase, **When** period cost is computed, **Then** the purchase does not count as that period's cost.
2. **Given** the same period, **When** period cost is computed, **Then** it equals the measured consumption for that period.
3. **Given** an opening balance, a set of purchases and measured consumption, **When** the credit balance is displayed, **Then** it equals opening + purchases − consumption, with the as-of date and the fact that it is derived, not read from Anthropic.
4. **Given** no opening balance has been recorded, **When** the balance is displayed, **Then** it is shown as unavailable rather than as a number derived from an assumed zero.

---

### User Story 5 - Workspace limits are recorded and reported against (Priority: P2)

An admin records the cap they set in the Claude Console for a workspace, and the Hub reports consumption against it, flags when it is approaching, and flags when the recorded cap disagrees with the allowances of the people in that workspace.

**Why this priority**: the allowances exist only as numbers in the licence register today — no live workspace has a cap recorded, so nothing reports against them. This closes the loop without pretending to enforce.

**Independent Test**: record a cap for an indie workspace, let consumption accumulate, and confirm utilisation, threshold flagging, and a mismatch flag when the cap differs from the owner's tier allowance.

**Acceptance Scenarios**:

1. **Given** an admin records a workspace cap, **When** the workspace is listed, **Then** current-period consumption, the cap, and utilisation are shown, with the date the cap was last confirmed.
2. **Given** consumption crosses a threshold of the recorded cap, **When** the workspace is listed or alerting evaluates, **Then** it is flagged.
3. **Given** a recorded cap that differs from the sum of its owners' tier allowances, **When** the workspace is viewed, **Then** the discrepancy is flagged with both figures.
4. **Given** any surface showing a recorded cap, **When** it is displayed, **Then** it is identified as a mirror of a Console-set limit that the Hub does not enforce.
5. **Given** a workspace with no recorded cap, **When** it is listed, **Then** it shows as having no cap recorded — never as unlimited or as zero.

---

### User Story 6 - Today's spend stays visible and honest (Priority: P2)

An admin watching the dashboard mid-morning still sees a current-day figure, clearly marked as an estimate, because Anthropic's cost API reports complete UTC days only.

**Why this priority**: switching to billed cost must not regress the intraday visibility the Hub has today — the original reason for computing locally, and still valid for one day.

**Independent Test**: with no cost bucket for today, confirm month-to-date still shows a today component, labelled, and that it is absent rather than zero when there is no data.

**Acceptance Scenarios**:

1. **Given** no cost bucket for the current UTC day, **When** month-to-date is displayed, **Then** it is billed-to-date plus a separately labelled today estimate.
2. **Given** the day completes and the next sync runs, **When** month-to-date is read again, **Then** the estimate is replaced by the billed figure with no double counting.
3. **Given** a user with no usage today, **When** their profile is read, **Then** no today estimate is shown.

---

### User Story 7 - Divergence surfaces within a day (Priority: P2)

When the Hub's estimate and Anthropic's billing disagree beyond a tolerance — a new model, a price change, a broken key mapping — an admin learns it from the Hub, not from a spot check months later.

**Why this priority**: the original defect ran for over a month undetected. Making the estimate exact where possible does not remove it everywhere, so what remains needs a watchdog.

**Independent Test**: seed a workspace whose billed total diverges beyond tolerance, run the sync, confirm a warning event naming the workspace, period and both figures.

**Acceptance Scenarios**:

1. **Given** a complete day where billed and computed cost differ beyond tolerance, **When** the cost sync runs, **Then** a sync event records it with both figures.
2. **Given** a usage row whose model is not in the price table, **When** the usage sync runs, **Then** a sync event names the model.
3. **Given** no divergence beyond tolerance, **When** the sync runs, **Then** no warning is produced.

---

### User Story 8 - Workspace ownership is visible and correctable (Priority: P3)

An admin can see which workspace each API-key holder maps to, whether it has one owner or several, and can correct a mapping.

**Independent Test**: open the workspace view, confirm owners and attribution mode are shown; change an assignment and confirm subsequent cost reads follow it.

**Acceptance Scenarios**:

1. **Given** the workspace list, **When** an admin views it, **Then** each workspace shows owner(s), attribution mode and current-period consumption.
2. **Given** a workspace with no resolved owner, **When** viewed, **Then** it is shown as unattributed with its spend intact.
3. **Given** a corrected owner mapping, **When** per-user costs are next read, **Then** they follow it without re-syncing Anthropic data.

---

### User Story 9 - The pooled boost-\* structure is retired (Priority: P3)

The 12 `boost-*` workspaces and the licences on them stop cluttering listings, cap aggregates, alerting and the licence register. Those licences were deactivated in the Claude Console some time ago; the Hub is still carrying them as active.

**Independent Test**: after the cleanup, confirm the pooled workspaces are excluded by default, their historical spend still appears in historical months, no alert can fire against them, and the licence register no longer counts the revoked assignments as active.

**Acceptance Scenarios**:

1. **Given** a deprecated workspace, **When** the workspace list or cap view renders, **Then** it is excluded by default and reachable via an explicit toggle.
2. **Given** a deprecated workspace with historical cost, **When** a past month is reported, **Then** its spend is still included.
3. **Given** a deprecated workspace, **When** cap alerting evaluates, **Then** it is skipped and its cap excluded from cap aggregates.
4. **Given** the 36 assignments on pooled workspaces, **When** the cleanup runs, **Then** each is revoked with an explicit revocation date, and the licence register stops counting them as active.
5. **Given** those revocations, **When** a budget period ending before the revocation date is reported, **Then** the assignments still count toward that period — revoking does not rewrite the past.
6. **Given** a boost-tier assignment that is **not** on a pooled workspace, **When** the cleanup runs, **Then** it is left untouched and reported separately for a decision.

---

## Requirements _(mandatory)_

### Attribution

- **FR-001**: The system MUST store Anthropic billed cost at line-item granularity (workspace, date, model, token type, context window, service tier) rather than a single daily total per workspace.
- **FR-002**: The system MUST record, per workspace, the Hub users whose resolved API keys belong to it, and derive an attribution mode: `billed` (exactly one owner), `apportioned` (more than one), `unattributed` (none).
- **FR-003**: For a `billed` workspace, per-user cost for complete days MUST equal the workspace's billed cost, without consulting the price table.
- **FR-004**: For an `apportioned` workspace, per-user cost for complete days MUST be the billed cost distributed across owners in proportion to their computed cost for the same day, with rounding remainders assigned deterministically so the parts sum exactly to the billed total.
- **FR-005**: For the current (incomplete) UTC day, per-user cost MUST come from the token-derived estimate.
- **FR-006**: Every cost figure returned by an API, MCP tool or UI surface MUST carry the method that produced it (`billed`, `apportioned`, `estimated`) and MUST NOT present an estimate as a billed figure.
- **FR-007**: Spend from a workspace with no resolved owner MUST NOT be attributed to any user, and MUST remain visible in org-level totals labelled as unattributed.

### Pricing model

- **FR-008**: Every access tier MUST carry a pricing model: `seat` (price is a recurring cost) or `usage` (price is a monthly allowance).
- **FR-009**: Expected spend for a `seat` tier MUST remain the tier price, byte-identical to today's behaviour.
- **FR-010**: Expected spend for a `usage` tier MUST be measured consumption for a completed period, and a projection from recent measured consumption for the current or a future period.
- **FR-011**: Where a `usage` assignment has no consumption history, expected spend MUST fall back to the allowance, and the figure MUST be marked as a fallback.
- **FR-012**: Every displayed money figure for a `usage` tier MUST state its basis: allowance, measured, projected, or allowance fallback. Seat-based wording MUST NOT change.

### Credits

- **FR-013**: Invoices for a `usage` tool MUST be recordable as credit purchases rather than period cost.
- **FR-014**: Period cost for a `usage` tool MUST be its measured consumption, never the credit purchases landing in that period.
- **FR-015**: The system MUST report a derived credit balance as opening balance + purchases − consumption, stating its as-of date and that it is derived by the Hub rather than read from Anthropic.
- **FR-016**: Where no opening balance has been recorded, the balance MUST be reported as unavailable rather than assumed to be zero.

### Limits

- **FR-017**: Administrators MUST be able to record, per workspace, the spend cap configured in the Claude Console, together with the date it was last confirmed.
- **FR-018**: The system MUST report consumption against a recorded cap and flag threshold crossings.
- **FR-019**: The system MUST flag when a recorded cap differs from the sum of the tier allowances of that workspace's owners, showing both figures.
- **FR-020**: Every surface showing a recorded cap MUST identify it as a mirror of a Console-set limit that the Hub does not enforce, and MUST distinguish "no cap recorded" from "no cap" and from zero.

### Operations

- **FR-021**: The cost sync MUST compare each workspace's billed cost against attributed computed cost for the same complete days and record a warning sync event beyond a configurable tolerance.
- **FR-022**: The usage sync MUST record a warning sync event when it encounters a model absent from the price table.
- **FR-023**: Administrators MUST be able to view and correct the workspace-to-user mapping, and corrections MUST take effect on the next cost read without re-syncing Anthropic data.
- **FR-024**: Workspaces MUST be markable as deprecated; deprecated workspaces MUST be excluded by default from listings, cap views and alerting, while their historical cost remains readable and included in historical totals.
- **FR-025**: The profile API and MCP tool responses MUST remain backward compatible: existing fields keep their names and meaning; attribution information is added alongside.
- **FR-026**: Historical per-user figures MUST be restated to billed cost for all months for which cost-report data can be retrieved, and the restatement MUST be recorded so a changed number can be explained.
- **FR-027**: The token-derived computation and the price table MUST be retained — they remain the apportionment weights, the current-day estimate, and the divergence-check input.
- **FR-028**: Licence assignments on deprecated pooled workspaces MUST be revoked, carrying an explicit revocation date rather than an implicit "now". Revocation MUST NOT alter what those assignments contributed to budget periods ending before that date.
- **FR-029**: The revocation MUST be scoped by **workspace**, not by tier. A boost-tier assignment on a workspace that is not deprecated MUST be left untouched and reported for a separate decision.
- **FR-030**: The revocation MUST be reversible in the sense that it is auditable — which assignments were revoked, when, and by which action — using the Hub's existing change-history mechanism.

### Key Entities

- **Workspace cost line item** — one billed amount for a workspace on a date at model / token-type / context-window / service-tier grain.
- **Workspace ownership** — which Hub users a workspace belongs to, plus an admin override. Determines attribution mode.
- **Attributed daily cost** — the per-user, per-day figure the Hub reports, carrying its method.
- **Tier pricing model** — whether a tier's price is a recurring cost or a monthly allowance.
- **Credit purchase** — an invoice recorded as prepayment for a usage-based tool rather than period cost.
- **Recorded workspace cap** — an admin-entered mirror of a Console-set spend limit, with a last-confirmed date.
- **Reconciliation event** — a recorded comparison of billed versus computed cost, with its outcome.

## Success Criteria _(mandatory)_

- **SC-001**: For every user in a single-owner workspace, the Hub's monthly cost for a completed month equals the Claude Console figure for that workspace exactly (0 cents difference).
- **SC-002**: A model released after the last price-table update changes no user's reported cost for any complete day.
- **SC-003**: Every cost figure exposed by the profile API, the MCP tools and the UI states its attribution method.
- **SC-004**: Expected spend for a completed period is within a stated tolerance of measured consumption for usage-based tools, and unchanged to the cent for seat-based tools.
- **SC-005**: No surface presents an allowance and a cost as the same kind of number.
- **SC-006**: A credit purchase never increases the reported cost of the period it lands in.
- **SC-007**: A divergence beyond tolerance between billed and computed cost is visible to an admin within one sync cycle.
- **SC-008**: Month-to-date remains available intraday with the estimated portion separately identifiable.
- **SC-009**: Every workspace either shows consumption against a recorded cap, or states that no cap is recorded.
- **SC-010**: Deprecated workspaces contribute nothing to cap aggregates or alerting, and their historical spend still appears in historical months.
- **SC-011**: Spend in workspaces with no owner is reported at org level and attributed to no user.
- **SC-012**: Existing consumers of the profile API continue to work without changes to the fields they already read.

## Assumptions

- `cost_report` remains daily-granularity only and continues to exclude the current UTC day; cost and usage data both appear within ~5 minutes of request completion.
- `cost_report` cannot attribute cost below workspace level, so multi-owner workspaces inherently require apportionment.
- The Anthropic Admin API exposes **no** endpoint for workspace spend limits or credit balance (verified against the Admin API reference). Caps and the opening credit balance are therefore admin-entered and can drift from the Console; the last-confirmed date exists to make that drift visible.
- Anthropic API access is prepaid via credits; invoices for it are top-ups whose timing is unrelated to the consumption they fund. Seat invoices are ordinary recurring charges, including the smaller ones raised when seats are added or upgraded mid-month.
- Every API-key holder reported on individually either has, or will be moved to, their own workspace. Users in a shared workspace are reported by apportionment and accepted as approximate.
- A workspace's cost-report history remains retrievable for the months to be restated; where it is not, those months keep their existing computed figures, marked as such.

## Open Questions

- **OQ-1**: ~~Should the assignments on deprecated pooled workspaces be revoked?~~ **Resolved 2026-09-18: yes.** They are already deactivated in the Claude Console, so the Hub is carrying licences that no longer exist. See US9 and FR-028. Two sub-questions remain and are called out there: the revocation date, and the one boost-tier assignment that is not on a pooled workspace.
- **OQ-2**: What projection window should a usage tier's expected spend use for current and future periods — a trailing 3-month mean is the spec's default, but the budget owner may prefer the last completed month, or a seasonal shape. Changing it later is a one-line change in a pure function.
- **OQ-3**: What revocation date should the pooled assignments carry? `revoked_at` decides which budget periods still count them, so today's date would keep them in every past period's expected spend. Org-wide Claude API spend collapsed from $3,016.86 (June 2026) to $194.89 (July 2026), which suggests the Console deactivation happened around the end of June. The spec defaults to an explicitly supplied date; if none is given, today, with the consequence stated.
- **OQ-4**: Assignment 262 (`boost-advanced` tier) belongs to the **`Automations`** workspace, which is live, has current spend and is not a pooled workspace. It is the only boost-tier assignment not on a `boost-*` pool. Revoke it with the rest, move it to a tier that reflects what it is, or leave it — a decision about that one licence, not about the cleanup.
