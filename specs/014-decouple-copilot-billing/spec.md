# Feature Specification: Decouple Copilot Billing from Budgets

**Feature Branch**: `014-decouple-copilot-billing`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "The cost and billing of the integration should be disconnected from the budget and invoices for now. A proper and fully functional integration for automated billing history imports will be added in a separate feature."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copilot Sync Runs Without Budget Dependency (Priority: P1)

An administrator enables and runs Copilot sync. The sync completes successfully regardless of whether any annual budgets or budget periods exist. Billing snapshots are captured and displayed on the Copilot billing page without requiring a corresponding budget period. No entries are created in the shared billed costs table.

**Why this priority**: This is the core decoupling — removing the hard dependency on budget periods unblocks Copilot sync for organizations that haven't configured budgets yet and eliminates orphaned snapshot records.

**Independent Test**: Can be fully tested by enabling Copilot sync on an org with no budgets configured and verifying all sync stages complete without errors and billing data appears on the Copilot billing page.

**Acceptance Scenarios**:

1. **Given** a GitHub connection with Copilot sync enabled and no annual budgets exist, **When** the sync runs, **Then** billing snapshots are stored and the sync completes successfully with no errors.
2. **Given** a GitHub connection with Copilot sync enabled and budget periods exist, **When** the sync runs, **Then** billing snapshots are stored but no `billedCosts` entries are created — the sync no longer writes to the shared billing table.
3. **Given** previously synced billing snapshots with linked billed cost references, **When** the decoupling migration runs, **Then** the link column and its foreign key are removed from the billing snapshots table and the backfill logic is removed from the sync pipeline.

---

### User Story 2 - Copilot Billing Page Shows All Data Independently (Priority: P1)

An administrator views the Copilot billing page. All billing snapshot data is displayed directly from the Copilot-specific tables without querying or depending on the shared billed costs table. Monthly cost breakdowns, seat counts, and cumulative spend are shown using snapshot data only.

**Why this priority**: The Copilot billing UI must remain fully functional after decoupling — users should see no regression in data availability.

**Independent Test**: Can be tested by navigating to the Copilot billing page and verifying all billing data renders correctly from snapshot data alone, even when no budget periods or billed cost entries exist.

**Acceptance Scenarios**:

1. **Given** billing snapshots exist for the connected org, **When** the user visits the Copilot billing page, **Then** monthly cost breakdowns, seat counts, and cumulative spend are displayed from snapshot data.
2. **Given** no budget periods or billed costs exist, **When** the user visits the Copilot billing page, **Then** the billing data still renders completely — there is no "missing data" state caused by absent budgets.

---

### User Story 3 - Copilot Costs No Longer Appear in Shared Reports (Priority: P2)

After decoupling, Copilot billing data no longer flows into the shared budget reports, spend trends, or dashboard KPIs. The main dashboard's "Monthly Spend" KPI, the reports page charts, and budget detail views no longer include Copilot cost entries. Copilot cost visibility is confined to the Copilot-specific pages.

**Why this priority**: Prevents double-counting and confusion when a future dedicated billing import feature is added. Clear separation now avoids data integrity issues later.

**Independent Test**: Can be tested by verifying the main dashboard KPIs and reports page charts do not include any Copilot-sourced cost data after decoupling.

**Acceptance Scenarios**:

1. **Given** Copilot billing snapshots exist, **When** the user views the main dashboard, **Then** the "Monthly Spend" KPI does not include Copilot costs.
2. **Given** Copilot billing snapshots exist, **When** the user views the reports page spend trends, **Then** no Copilot entries appear in the cost breakdown charts.
3. **Given** existing billed cost entries created by previous Copilot syncs, **When** the decoupling migration runs, **Then** those entries are cleaned up so they no longer affect reports.

---

### User Story 4 - Copilot Seats Remain Visible in Assignments (Priority: P2)

Copilot seat assignments continue to flow into the shared license assignments table. The existing assignments page still shows Copilot seats. This coupling is intentional and retained — only the billing/cost coupling is removed.

**Why this priority**: License assignment tracking is a separate concern from billing. Keeping seats in the shared model maintains visibility for administrators without creating billing side-effects.

**Independent Test**: Can be tested by running a Copilot sync and verifying seats appear on both the Copilot seats page and the shared assignments page.

**Acceptance Scenarios**:

1. **Given** Copilot sync runs successfully, **When** the user views the assignments page, **Then** Copilot seats appear with the "copilot-sync" source label.
2. **Given** Copilot sync runs successfully, **When** the user views the Copilot seats page, **Then** all seat data is displayed as before.

---

### User Story 5 - AI Tool and Tier Records Remain for Seat Tracking (Priority: P3)

The sync continues to create and update the "GitHub Copilot" AI tool record and its access tiers (Business/Enterprise) since these are needed for the license assignment model. However, the pricing on these tiers is informational only — it is not used to generate billed cost entries.

**Why this priority**: Preserves the data model integrity for license assignments without introducing billing side-effects.

**Independent Test**: Can be tested by running sync and verifying the AI tool and tier records exist and are referenced by license assignments, but no cost entries are created from them.

**Acceptance Scenarios**:

1. **Given** Copilot sync runs, **When** the sync completes, **Then** the "GitHub Copilot" AI tool and its access tiers are created or updated.
2. **Given** the AI tool and tiers exist, **When** the user views the tools page, **Then** "GitHub Copilot" appears with its tier pricing as informational data.

---

### Edge Cases

- What happens when a sync runs during the migration rollout? The sync should gracefully handle the absence of the link column if the migration has already run.
- What happens to existing billed cost entries from previous Copilot syncs? Only entries with vendor references matching the `copilot-billing-*` pattern are cleaned up by the migration. Manually created entries are preserved.
- What happens if the future billing import feature is added? It will use its own integration path — the decoupled billing snapshots serve as the source of truth for Copilot-specific cost visibility only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Copilot sync pipeline MUST NOT create, update, or reference entries in the shared billed costs table.
- **FR-002**: The billing snapshots table MUST have the linked billed cost reference column and its foreign key removed via a schema migration.
- **FR-003**: The backfill function that creates deferred billed cost entries MUST be removed from the sync pipeline.
- **FR-004**: The billing data sync function MUST be updated to skip all budget period lookups and billed cost creation logic.
- **FR-005**: The Copilot billing page MUST display all cost data exclusively from billing snapshots with no regression in data availability.
- **FR-006**: Existing billed cost entries with vendor references matching the Copilot sync pattern MUST be deleted by the migration.
- **FR-007**: The main dashboard KPIs and reports page MUST NOT include any Copilot-sourced cost data after migration.
- **FR-008**: Copilot seat sync MUST continue to create and update license assignments — this coupling is retained.
- **FR-009**: The "GitHub Copilot" AI tool and its access tiers MUST continue to be created and updated during sync for license assignment references.
- **FR-010**: The sync pipeline MUST complete all stages (billing snapshot, seat assignments, usage metrics) without requiring any budget or invoice configuration.

### Key Entities

- **Copilot Billing Snapshot**: Monthly billing record per GitHub org — stores seat counts, cost per seat, and total cost. After decoupling, this is the sole source of truth for Copilot cost data. No longer links to shared billed costs.
- **Billed Cost (modified)**: Shared billing table — Copilot-generated entries removed. Future billing import feature will re-establish a proper integration path.
- **License Assignment (unchanged)**: Shared seat tracking — continues to receive Copilot seat data via sync.
- **AI Tool / Access Tier (unchanged)**: Shared tool and tier definitions — continues to be updated by sync for license assignment references.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Copilot sync completes successfully on organizations with zero budget configuration — 100% success rate with no errors or warnings related to missing budgets.
- **SC-002**: All Copilot billing data is visible on the Copilot billing page within 5 seconds of page load, with no dependency on budget or invoice data.
- **SC-003**: After migration, the main dashboard "Monthly Spend" KPI and reports page charts contain zero Copilot-sourced cost entries.
- **SC-004**: Copilot seat assignments continue to appear on both the Copilot seats page and the shared assignments page with no data loss.
- **SC-005**: The decoupling migration completes in under 30 seconds and is fully reversible.

## Assumptions

- The Copilot billing page already reads from billing snapshots directly and does not depend on the shared billed costs table for its display.
- The cost-at-assignment field on license assignments is retained as informational data and does not drive any billing calculations.
- A future dedicated feature will handle the proper integration between Copilot billing and the budget/invoice system with full automated billing history imports.
- Only billed cost entries with vendor references matching `copilot-billing-*` are Copilot-sync-generated and safe to clean up.

## Scope Boundaries

### In Scope

- Removing the linked billed cost reference from the billing snapshots schema
- Removing the backfill function from the sync pipeline
- Removing budget period lookup and billed cost creation from billing data sync
- Cleaning up existing Copilot-sourced billed cost entries
- Verifying Copilot billing page works independently

### Out of Scope

- Changes to license assignment sync (seats continue to flow into shared model)
- Changes to AI tool or tier creation during sync
- Changes to Copilot usage metrics sync
- Multi-org support
- Automated billing history imports (separate future feature)
- Changes to the Copilot UI pages beyond verifying no regression
- Changes to the shared reports or dashboard code (Copilot data simply won't be present after cleanup)
