# Data Model: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02
**ORM**: Drizzle ORM | **Database**: Neon PostgreSQL (serverless)

---

## Entity Relationship Diagram (Text)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   ai_tools   │────<│   access_tiers   │>────│  license_    │
│              │  1:N │                  │  1:N │  assignments │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                     │ N:1
                                                     │
┌──────────────┐                                     │
│    users     │─────────────────────────────────────┘
│              │  1:N
└──────────────┘

┌──────────────┐     ┌──────────────────┐
│annual_budgets│────<│  budget_periods   │
│              │  1:N │                  │
└──────────────┘     └──────────────────┘

┌──────────────────┐
│  change_history  │  (polymorphic audit log — references any entity)
└──────────────────┘
```

---

## Entities

### 1. users

Company employees eligible for AI tool access. Also used for application login (Admin/Viewer).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `name` | `varchar(255)` | NOT NULL | Full name |
| `email` | `varchar(255)` | NOT NULL, UNIQUE | Primary identifier (company email) |
| `password_hash` | `varchar(255)` | NOT NULL | bcryptjs hashed password |
| `github_username` | `varchar(255)` | NULL | Optional GitHub handle |
| `department` | `varchar(100)` | NOT NULL | Organizational department |
| `role` | `enum('admin', 'viewer')` | NOT NULL, DEFAULT 'viewer' | Application access role |
| `status` | `enum('active', 'inactive')` | NOT NULL, DEFAULT 'active' | Employment status |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `email` (unique), `department`, `status`
**Validation Rules**:
- `email` must be a valid email format (Zod `.email()`)
- `name` minimum 1 character
- `department` minimum 1 character
- Deactivating a user triggers cascading revocation of all active license assignments (FR-007)

---

### 2. ai_tools

Registered AI coding tools available for license assignment.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `name` | `varchar(255)` | NOT NULL, UNIQUE | Tool display name |
| `vendor` | `varchar(255)` | NOT NULL | Tool vendor/provider |
| `description` | `text` | NULL | Optional description |
| `max_licenses` | `integer` | NULL | Maximum license capacity (NULL = unlimited) |
| `status` | `enum('active', 'archived')` | NOT NULL, DEFAULT 'active' | |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `name` (unique), `vendor`
**Validation Rules**:
- `max_licenses` must be >= 0 when provided
- Cannot delete/archive a tool with active license assignments (FR-019)

---

### 3. access_tiers

Pricing and feature levels for AI tools. Each tier belongs to one tool.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `tool_id` | `integer` | NOT NULL, FK → ai_tools.id | Parent tool |
| `name` | `varchar(100)` | NOT NULL | Tier name (e.g., Free, Pro, Enterprise) |
| `description` | `text` | NULL | Tier feature details |
| `monthly_cost_cents` | `integer` | NOT NULL | Per-user monthly cost in cents |
| `is_active` | `boolean` | NOT NULL, DEFAULT true | Whether tier is currently available |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `tool_id`, (`tool_id`, `name`) UNIQUE
**Validation Rules**:
- `monthly_cost_cents` must be >= 0
- `name` must be unique within the same tool
- Updating `monthly_cost_cents` only affects future calculations; historical records retain original cost (FR-020)
- Monetary values stored in cents (integer) to avoid floating-point precision issues

---

### 4. license_assignments

Core tracking entity: links a user to a tool at a specific tier.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `user_id` | `integer` | NOT NULL, FK → users.id | Assigned user |
| `tool_id` | `integer` | NOT NULL, FK → ai_tools.id | Assigned tool |
| `tier_id` | `integer` | NOT NULL, FK → access_tiers.id | Selected tier |
| `cost_at_assignment_cents` | `integer` | NOT NULL | Tier cost snapshot at assignment time |
| `status` | `enum('active', 'inactive')` | NOT NULL, DEFAULT 'active' | |
| `assigned_at` | `timestamp` | NOT NULL, DEFAULT now() | Assignment date |
| `revoked_at` | `timestamp` | NULL | Revocation date (set when deactivated) |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `user_id`, `tool_id`, `tier_id`, `status`, (`user_id`, `tool_id`, `status`) for active-assignment lookup
**Validation Rules**:
- A user can have at most one active assignment per tool. Assigning a different tier replaces (deactivates) the existing one.
- Assignment must check `ai_tools.max_licenses` — count of active assignments for the tool must not exceed the limit (FR-006)
- `cost_at_assignment_cents` is a snapshot of `access_tiers.monthly_cost_cents` at the time of assignment (FR-020)
- Revoking sets `status = 'inactive'` and `revoked_at = now()` (FR-005)

**State Transitions**:
```
[new] ──assign──→ active ──revoke──→ inactive
                    │
                    └──upgrade/downgrade──→ inactive (old) + active (new)
```

---

### 5. annual_budgets

Fiscal year spending plans for AI tools.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `fiscal_year` | `integer` | NOT NULL, UNIQUE | e.g., 2026 |
| `total_amount_cents` | `integer` | NOT NULL | Annual budget total in cents |
| `period_type` | `enum('monthly', 'quarterly')` | NOT NULL | Allocation granularity |
| `status` | `enum('active', 'archived')` | NOT NULL, DEFAULT 'active' | |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `fiscal_year` (unique), `status`
**Validation Rules**:
- `total_amount_cents` must be > 0
- `fiscal_year` must be a valid 4-digit year
- Only one active budget allowed per fiscal year
- Creating a new year's budget archives the previous year's budget as read-only (FR-021)
- `period_type` is set at creation time and determines the number of budget periods (12 for monthly, 4 for quarterly)

---

### 6. budget_periods

Time segments within an annual budget with planned allocations.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `budget_id` | `integer` | NOT NULL, FK → annual_budgets.id | Parent budget |
| `period_label` | `varchar(20)` | NOT NULL | e.g., "Jan 2026", "Q1 2026" |
| `period_index` | `integer` | NOT NULL | 0-based ordering (0–11 monthly, 0–3 quarterly) |
| `start_date` | `date` | NOT NULL | Period start date |
| `end_date` | `date` | NOT NULL | Period end date |
| `planned_amount_cents` | `integer` | NOT NULL, DEFAULT 0 | Allocated budget for this period |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Auto-updated |

**Indexes**: `budget_id`, (`budget_id`, `period_index`) UNIQUE
**Validation Rules**:
- Sum of `planned_amount_cents` across all periods must not exceed `annual_budgets.total_amount_cents` (FR-010)
- `period_index` must be within range for the budget's `period_type`
- Periods are auto-generated when a budget is created (12 for monthly, 4 for quarterly)

**Computed Values** (not stored, calculated at query time):
- `actual_spend_cents`: Sum of `cost_at_assignment_cents` for all active assignments during this period, prorated by days active within the period
- `variance_cents`: `planned_amount_cents - actual_spend_cents`
- `is_overrun`: `actual_spend_cents > planned_amount_cents * 1.10` (FR-013: 10% threshold)

---

### 7. change_history

Polymorphic audit log for all entity modifications.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `serial` | PK | Auto-increment |
| `entity_type` | `varchar(50)` | NOT NULL | 'user', 'ai_tool', 'access_tier', 'license_assignment', 'annual_budget', 'budget_period' |
| `entity_id` | `integer` | NOT NULL | ID of the modified entity |
| `change_type` | `enum('created', 'updated', 'deleted', 'status_change')` | NOT NULL | Type of modification |
| `field_name` | `varchar(100)` | NULL | Specific field changed (NULL for creation/deletion) |
| `previous_value` | `text` | NULL | JSON-encoded previous value |
| `new_value` | `text` | NULL | JSON-encoded new value |
| `changed_by` | `integer` | NOT NULL, FK → users.id | User who made the change |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | Timestamp of change |

**Indexes**: (`entity_type`, `entity_id`), `changed_by`, `created_at`
**Notes**:
- Append-only table — records are never updated or deleted
- `previous_value` and `new_value` are JSON-encoded strings to handle any field type
- For bulk operations, one history record per entity changed (not one per batch)

---

## Relationships Summary

| From | To | Cardinality | FK Column | ON DELETE |
|------|----|-------------|-----------|----------|
| access_tiers | ai_tools | N:1 | `access_tiers.tool_id` | CASCADE |
| license_assignments | users | N:1 | `license_assignments.user_id` | RESTRICT |
| license_assignments | ai_tools | N:1 | `license_assignments.tool_id` | RESTRICT |
| license_assignments | access_tiers | N:1 | `license_assignments.tier_id` | RESTRICT |
| budget_periods | annual_budgets | N:1 | `budget_periods.budget_id` | CASCADE |
| change_history | users (changed_by) | N:1 | `change_history.changed_by` | RESTRICT |

**ON DELETE reasoning**:
- `RESTRICT` on license_assignments FKs ensures tools/users/tiers cannot be deleted while active assignments exist (FR-019)
- `CASCADE` on access_tiers → ai_tools so tiers are removed when a tool is deleted (only possible after all assignments are revoked)
- `CASCADE` on budget_periods → annual_budgets so periods are removed with their budget

---

## Actual Spend Calculation (FR-011)

Actual spending per period is calculated dynamically, not stored:

```sql
-- Per-tool spending for a budget period
SELECT
  t.name AS tool_name,
  SUM(la.cost_at_assignment_cents) AS monthly_cost_cents
FROM license_assignments la
JOIN ai_tools t ON la.tool_id = t.id
WHERE la.status = 'active'
  AND la.assigned_at <= :period_end_date
  AND (la.revoked_at IS NULL OR la.revoked_at >= :period_start_date)
GROUP BY t.id, t.name;
```

This approach:
- Uses `cost_at_assignment_cents` (snapshot) to preserve historical pricing (FR-020)
- Calculates per-tool breakdown automatically (FR-011, FR-012)
- Avoids data duplication / sync issues
