# Feature Specification: Invoice Ingestion Filters

**Feature Branch**: `024-ingestion-filter`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "Filter invoice PDFs post-ingestion to prevent irrelevant documents from being linked to budget periods. Invoices are always stored; filtering only controls budget linking. Invoice PDFs only (single upload, bulk upload, API ingest). Global rules, managed by admins only. Future ingestions only — no retroactive application."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin creates a blacklist filter rule (Priority: P1)

An admin navigates to the ingestion settings area and creates a new filter rule to exclude invoices from a specific vendor (e.g., "Office Supplies Co") from being linked to any budget period. After saving, all future invoices from that vendor are still stored in the system but are marked as filtered and never create budget cost entries.

**Why this priority**: This is the core value — preventing irrelevant invoices from polluting budget data. Without this, admins must manually unlink or ignore invoices, which is error-prone and time-consuming.

**Independent Test**: Can be fully tested by creating a blacklist vendor rule, then ingesting an invoice matching that vendor. The invoice should be stored but not linked to any budget period, and should appear as "filtered" in the ingestion history.

**Acceptance Scenarios**:

1. **Given** an admin is on the ingestion settings page, **When** they create a blacklist rule for vendor "Office Supplies Co" and save it, **Then** the rule appears in the filters list as enabled.
2. **Given** an enabled blacklist vendor rule for "Office Supplies Co" exists, **When** an invoice from "Office Supplies Co" is ingested via any channel, **Then** the invoice is stored but not linked to a budget period and is marked as filtered.
3. **Given** an enabled blacklist vendor rule for "Office Supplies Co" exists, **When** an invoice from "Anthropic" is ingested, **Then** the invoice is processed normally and linked to a budget period as before.

---

### User Story 2 - Admin creates a whitelist filter rule (Priority: P1)

An admin creates a whitelist rule so that only invoices matching specific criteria are linked to budgets. For example, a whitelist vendor rule with values ["Anthropic", "OpenAI"] means only invoices from those vendors get budget-linked; all others are stored but filtered out.

**Why this priority**: Equally critical to blacklisting — some organizations know exactly which vendors are budget-relevant and want to include only those.

**Independent Test**: Can be tested by creating a whitelist vendor rule, then ingesting one matching and one non-matching invoice. Only the matching invoice should be budget-linked.

**Acceptance Scenarios**:

1. **Given** a whitelist vendor rule with values ["Anthropic", "OpenAI"] exists, **When** an invoice from "Anthropic" is ingested, **Then** the invoice is stored and linked to a budget period normally.
2. **Given** a whitelist vendor rule with values ["Anthropic", "OpenAI"] exists, **When** an invoice from "Staples" is ingested, **Then** the invoice is stored but not linked to a budget period and is marked as filtered.
3. **Given** both a whitelist and a blacklist rule exist, **When** an invoice matches a blacklist rule, **Then** it is filtered out regardless of whitelist rules (blacklist takes precedence).

---

### User Story 3 - Admin filters by invoice number pattern (Priority: P2)

An admin creates a filter rule using a text pattern to match invoice numbers. For example, a blacklist rule with pattern "INTERNAL-" filters out all invoices whose number contains "INTERNAL-".

**Why this priority**: Invoice number patterns are useful for systematically excluding known categories of documents (e.g., internal transfers, test invoices) without manual intervention.

**Independent Test**: Can be tested by creating an invoice number pattern rule, then ingesting invoices with matching and non-matching invoice numbers.

**Acceptance Scenarios**:

1. **Given** a blacklist invoice number rule with pattern "TEST-" exists, **When** an invoice with number "TEST-001" is ingested, **Then** it is stored but marked as filtered.
2. **Given** a blacklist invoice number rule with pattern "TEST-" exists, **When** an invoice with number "INV-2026-042" is ingested, **Then** it is processed normally.
3. **Given** a malformed pattern is submitted, **When** the admin tries to save the rule, **Then** the system rejects it with a validation error.

---

### User Story 4 - Admin manages existing filter rules (Priority: P2)

An admin can view all filter rules, enable/disable individual rules without deleting them, edit rule parameters, and delete rules entirely. Changes take effect for future ingestions only.

**Why this priority**: Ongoing management is necessary once rules exist — admins need to iterate on rules as vendor relationships and budget scopes change.

**Independent Test**: Can be tested by creating a rule, disabling it, ingesting an invoice that would match, and confirming the invoice is not filtered.

**Acceptance Scenarios**:

1. **Given** an enabled filter rule exists, **When** the admin disables it, **Then** subsequent ingestions ignore that rule.
2. **Given** a disabled filter rule exists, **When** the admin re-enables it, **Then** subsequent ingestions apply that rule again.
3. **Given** a filter rule exists, **When** the admin deletes it, **Then** it is removed from the system and previously filtered invoices remain unchanged.
4. **Given** a filter rule exists, **When** the admin edits its value (e.g., adds a vendor to the list), **Then** subsequent ingestions use the updated rule.

---

### User Story 5 - Filtered invoices are visible in ingestion history (Priority: P3)

When viewing the ingestion history, filtered invoices appear with a distinct visual indicator (e.g., "Filtered" badge) so admins can audit which invoices were excluded and why. The matched rule name is recorded.

**Why this priority**: Auditability is important for trust — admins need to verify filters are working correctly and diagnose unexpected behavior.

**Independent Test**: Can be tested by ingesting an invoice that matches a filter, then checking the ingestion history for the "filtered" outcome and the rule name.

**Acceptance Scenarios**:

1. **Given** an invoice was filtered during ingestion, **When** an admin views the ingestion history, **Then** the entry shows a "Filtered" outcome with the name of the rule that caused it.
2. **Given** an invoice was filtered during ingestion, **When** an admin views the invoice detail, **Then** the invoice is visually marked as excluded from budget tracking.

---

### Edge Cases

- What happens when multiple rules match the same invoice? Blacklist rules always take precedence. Among blacklist rules, the first match (by priority) is reported as the reason.
- What happens when no filter rules exist? All invoices pass through to budget linking as before — no-rules means no filtering.
- What happens when all rules are disabled? Same as no rules — all invoices pass through.
- What happens when an invoice field used for matching is missing or empty (e.g., vendor not extracted)? A missing field does not match any whitelist or blacklist rule for that field. If a whitelist rule exists for that field, a missing value means "no match" and the invoice is filtered out.
- What happens when a filter rule is created while a bulk upload is in progress? Rules are evaluated at the moment each individual invoice is processed; mid-upload rule changes apply to not-yet-processed invoices in the batch.
- What happens to invoices that were filtered if the rule is later deleted? They remain marked as filtered. No retroactive re-evaluation occurs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow admins to create filter rules with a name, field (vendor or invoice number), mode (whitelist or blacklist), and field-specific value configuration.
- **FR-002**: System MUST support vendor filter values as a list of text strings matched case-insensitively as substrings against the extracted vendor name.
- **FR-003**: System MUST support invoice number filter values as a regular expression pattern tested against the extracted invoice number.
- **FR-004**: System MUST validate regular expression patterns at rule creation time and reject invalid patterns.
- **FR-005**: System MUST allow admins to enable, disable, edit, and delete filter rules.
- **FR-006**: System MUST evaluate all enabled filter rules against each newly ingested invoice, after field extraction and before budget period linking.
- **FR-007**: System MUST give blacklist rules strict precedence — if any blacklist rule matches, the invoice is filtered out regardless of whitelist rules.
- **FR-008**: System MUST evaluate whitelist rules using OR logic across fields — if whitelist rules exist and the invoice matches any one field's whitelist, it passes. The invoice is only filtered out if whitelist rules exist and none match across any field.
- **FR-009**: System MUST always store the invoice record and file regardless of filter outcome.
- **FR-010**: System MUST mark filtered invoices distinctly on the invoice record so they can be queried and displayed separately.
- **FR-011**: System MUST log filtered ingestions with a "filtered" outcome in the ingestion history, including the name of the matched rule.
- **FR-012**: System MUST skip budget period lookup and cost record creation for filtered invoices.
- **FR-013**: System MUST apply filter rules to all invoice ingestion channels: single API upload, bulk upload, and manual UI upload.
- **FR-014**: System MUST restrict filter rule management to admin users only.
- **FR-015**: System MUST NOT retroactively apply filter rules to previously ingested invoices.
- **FR-016**: System MUST support a priority field on rules to determine evaluation order (lower number = higher priority).
- **FR-017**: When no filter rules exist or all rules are disabled, the system MUST pass all invoices through to budget linking without modification.

### Key Entities

- **Ingestion Filter**: A named rule that defines criteria for filtering invoices. Has a field (vendor or invoice number), a mode (whitelist or blacklist), a field-specific value configuration, an enabled/disabled state, a priority for evaluation ordering, and an audit trail of who created it and when.
- **Invoice** (extended): Existing invoice entity gains a filtered-out indicator showing whether it was excluded from budget linking by a filter rule.
- **Ingestion Log** (extended): Existing ingestion log gains a "filtered" outcome type to record when an invoice was stored but excluded from budget linking, along with the reason.

## Assumptions

- Vendor matching uses case-insensitive substring matching (e.g., rule value "anthropic" matches vendor "Anthropic, PBC"). This is the pragmatic default for vendor name variations.
- Regular expression patterns for invoice number matching use standard regex syntax. Pattern complexity is limited by length to mitigate performance concerns.
- Filter rules are global — they apply to all budgets uniformly. Per-budget scoping is out of scope.
- The filter management UI lives within the existing ingestion settings area, co-located with ingestion history.
- When multiple blacklist rules match, the highest-priority (lowest number) rule is recorded as the filter reason.
- Bulk upload processes each invoice individually through the same filter pipeline; there is no batch-level filtering.

## Clarifications

### Session 2026-03-27

- Q: When whitelist rules exist for both vendor AND invoice number, must an invoice pass all field whitelists (AND) or any one (OR)? → A: OR — invoice passes if it matches any one field's whitelist rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can create, edit, enable/disable, and delete filter rules in under 30 seconds per operation.
- **SC-002**: Filtered invoices are never linked to budget periods — 100% accuracy in preventing budget-linking for matched invoices.
- **SC-003**: Non-matching invoices continue to be budget-linked exactly as before — zero false positives from the filter system.
- **SC-004**: All filtered invoices are visible in ingestion history with a distinct "Filtered" indicator and the rule name, providing full auditability.
- **SC-005**: Filter evaluation adds no user-perceptible delay to the ingestion process.
- **SC-006**: The system continues to function identically to its current behavior when no filter rules are configured.
