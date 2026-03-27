# Feature Specification: Running API Costs in Budget View

**Feature Branch**: `025-running-api-costs`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "The Anthropic API costs sync is showing running API cost in the budget for the current month. The backfill option for this sync should add the cost of the past month in the same way to the budget view, so that the past api costs can be calculated into the budget. The normal sync should update the running costs without duplicating them. the backfill should show historical data for a complete budget view."

## Current State (Already Implemented)

The regular Anthropic API costs sync already populates running costs in the budget view for the **current month**:

- The `anthropic_api_costs` sync fetches workspace-level cost data from the Anthropic cost report API and writes it to the `anthropic_workspace_costs` table (one row per workspace per month).
- The budget detail view calls `getRunningCostsForPeriod()` which aggregates `anthropic_workspace_costs` rows whose dates fall within a budget period's date range.
- The budget view displays the combined total as "Actual (incl. API)" alongside manually entered billed costs.
- The regular sync updates the current month's data on each run without duplication (upsert by workspace + month).
- The budget view already distinguishes running API costs from manual billed costs — they appear as a separate "Running API Costs" line item with source attribution.

**What works today**: Current-month API costs appear in the budget view after each sync. Repeated syncs update the amount in place.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Backfill Populates Historical API Costs in Budget (Priority: P1)

As a budget administrator, I want to backfill past months' Anthropic API costs so they appear in historical budget periods, giving me a complete and accurate picture of total spend across the entire budget timeline.

The existing backfill mechanism for `anthropic_api_costs` already iterates month-by-month and populates `anthropic_workspace_costs`. Since `getRunningCostsForPeriod()` queries by the budget period's date range, historical periods should display API costs once the backfill has populated the data. This story ensures the backfill correctly writes historical workspace cost data so the budget view can pick it up — using the same read-time aggregation pattern that already works for the current month.

**Why this priority**: Without historical cost data in the budget, past periods appear underspent and reports are inaccurate. This is the primary gap preventing a complete budget view.

**Independent Test**: Trigger a backfill for the last 6 months via the sync settings UI. Verify that each past month's budget period now shows running API costs matching the Anthropic cost report data for that month.

**Acceptance Scenarios**:

1. **Given** budget periods exist for January through March 2026 and Anthropic API usage occurred in those months, **When** the administrator triggers a backfill for `anthropic_api_costs` starting from January 2026, **Then** the budget view for each of those periods shows running API costs reflecting the workspace cost data for that month.
2. **Given** a backfill has already been run for February 2026, **When** the backfill is triggered again covering February, **Then** the existing workspace cost rows are updated (not duplicated) and the budget view reflects the latest amounts.
3. **Given** a month within the backfill range has no matching budget period, **When** the backfill runs, **Then** the workspace cost data is still stored (for future period creation) and the backfill continues processing remaining months without error.
4. **Given** the Anthropic cost report API returns zero usage for a historical month, **When** the backfill processes that month, **Then** no cost row is created for that month (consistent with how `getRunningCostsForPeriod()` returns null for zero totals).

---

### User Story 2 - Normal Sync Updates Without Duplication (Priority: P1)

As a budget administrator, I want the regular (cron-triggered) sync to keep updating the current month's running costs without creating duplicate entries, so that the budget view always shows accurate, up-to-date API spend.

This is already working today. This story serves as a regression guard to ensure the backfill changes do not break the existing current-month sync behavior.

**Why this priority**: The current-month sync is the live view administrators rely on daily. Any regression here would immediately impact budget accuracy.

**Independent Test**: Run the regular `anthropic_api_costs` sync three times in succession. Verify there is exactly one workspace cost row per workspace per month, and the budget view total matches the latest sync data.

**Acceptance Scenarios**:

1. **Given** the regular sync has already populated current-month data, **When** the sync runs again with updated cost data from the Anthropic API, **Then** the existing workspace cost rows are updated in place and the budget view reflects the new totals.
2. **Given** a new workspace appears in the Anthropic cost report that did not exist before, **When** the sync runs, **Then** a new workspace cost row is created for the current month and the budget view includes it in the running total.
3. **Given** the sync runs 5 consecutive times with no cost changes, **Then** the number of workspace cost rows and the budget total remain unchanged.

---

### User Story 3 - Complete Budget View Across All Periods (Priority: P2)

As a budget administrator, I want to see a unified budget view where every period — past and present — includes both manual billed costs and API running costs, so that I can assess overall budget health at a glance.

After backfill has been run, the budget overview (list of all periods) should show the combined "Actual (incl. API)" figure for historical periods, not just the current one.

**Why this priority**: The per-period detail already works once data exists; this story ensures the overview/summary level also reflects historical API costs.

**Independent Test**: After running a backfill, view the annual budget overview page. Verify that historical periods show "Actual (incl. API)" totals that include the backfilled API costs.

**Acceptance Scenarios**:

1. **Given** a backfill has populated workspace costs for January-March 2026, **When** the administrator views the annual budget overview, **Then** each of those periods shows an "Actual (incl. API)" total that includes both manual billed costs and running API costs.
2. **Given** a budget period has no API cost data (backfill not run or zero usage), **When** the administrator views the overview, **Then** the period shows only the manual billed cost total without an "(incl. API)" label.

---

### Edge Cases

- What happens when a budget period spans multiple months (e.g., quarterly)? `getRunningCostsForPeriod()` already aggregates all workspace cost rows whose dates fall within the period's date range, so multi-month periods are handled correctly.
- What happens when the backfill window exceeds 24 months? The existing backfill validation rejects start dates more than 24 months ago.
- What happens when the Anthropic API is unreachable during backfill? The sync framework's existing error handling records the failure in sync events. Partially completed months retain their data; the administrator can retry.
- What happens when workspace cost data is backfilled but no budget period exists for that month yet? The data persists in `anthropic_workspace_costs` and will automatically appear in the budget view once a covering budget period is created.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST populate `anthropic_workspace_costs` for each historical month when a backfill is triggered for the `anthropic_api_costs` source.
- **FR-002**: System MUST use upsert semantics when writing workspace cost rows during backfill, so that repeated backfills update existing rows rather than creating duplicates.
- **FR-003**: System MUST continue processing remaining months if a single month in the backfill range fails or returns no data.
- **FR-004**: System MUST NOT alter the existing current-month sync behavior when adding or modifying backfill logic.
- **FR-005**: Budget view MUST display running API costs for any budget period that has corresponding data in `anthropic_workspace_costs`, regardless of whether the data came from a regular sync or a backfill.
- **FR-006**: Budget overview MUST show the combined "Actual (incl. API)" total for historical periods once backfill data is available.
- **FR-007**: System MUST record backfill operations in the sync events log with operation type "backfill", including counts of created and updated rows.

### Key Entities

- **Anthropic Workspace Costs**: Existing table storing monthly cost totals per workspace. Populated by both regular sync (current month) and backfill (historical months). Read by `getRunningCostsForPeriod()` to display in budget view.
- **Budget Period**: Existing entity with start/end dates. Running costs are matched by date overlap at read time — no foreign key relationship to workspace costs.
- **Sync Event**: Existing entity that logs each sync/backfill operation with outcome, counts, and timing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a backfill covering 6 months, 100% of budget periods within that range show running API costs in the budget view (where Anthropic cost data exists for the period's date range).
- **SC-002**: Running the backfill 3 consecutive times for the same date range produces identical workspace cost row counts and amounts (zero duplicates, idempotent updates).
- **SC-003**: The regular current-month sync continues to update the budget view within 1 minute of completion, with no regression from backfill changes.
- **SC-004**: The budget overview page shows "Actual (incl. API)" for all periods that have both billed costs and running API costs, including historical periods after backfill.

## Assumptions

- The existing `getRunningCostsForPeriod()` function already handles historical periods correctly — it queries by date range, not by "current month". No changes are needed to this function.
- The existing backfill for `anthropic_api_costs` already iterates month-by-month and calls `fetchAndUpsertWorkspaceCosts()`. The primary work may be verifying this end-to-end flow and fixing any gaps.
- Workspace-level costs (from the Anthropic cost report API) are the authoritative source for budget integration, not user-level usage metrics — this avoids double-counting.
- The budget overview page already calls `getRunningCostsForPeriod()` for each period. If it only does so for the current period, it will need to be updated to call it for all periods.
