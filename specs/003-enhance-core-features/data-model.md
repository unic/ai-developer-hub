# Data Model: Enhance Core Features

**Feature Branch**: `003-enhance-core-features`
**Date**: 2026-03-03

## Entity Overview

```text
users ─────────────── licenseAssignments ─── accessTiers ─── aiTools
  │ (circle field)         │  │                                  │
  │                        │  └── assignmentComments              │
  │                        │                                     │
  └── changeHistory ◄──────┘                                     │
                           │                                     │
                     budgetPeriods ── billedCosts                 │
                           │                                     │
                     annualBudgets                               │
```

---

## Modified Entities

### users (column rename)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| id | serial | PK | — |
| name | varchar(255) | NOT NULL | — |
| email | varchar(255) | NOT NULL, UNIQUE | — |
| passwordHash | varchar(255) | NOT NULL | — |
| githubUsername | varchar(255) | nullable | — |
| **circle** | varchar(100) | NOT NULL, indexed | **RENAMED** from `department` |
| role | enum(admin, viewer) | NOT NULL, default: viewer | — |
| status | enum(active, inactive) | NOT NULL, default: active | — |
| preferences | jsonb | nullable | — |
| createdAt | timestamp | NOT NULL, default: now() | — |
| updatedAt | timestamp | NOT NULL, default: now() | — |

**Migration**: `ALTER TABLE "users" RENAME COLUMN "department" TO "circle";` + `ALTER INDEX "users_department_idx" RENAME TO "users_circle_idx";`

**Validation**: `z.string().min(1, "Circle is required").max(100)`

---

### licenseAssignments (new fields)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| id | serial | PK | — |
| userId | integer | FK → users.id (restrict) | — |
| toolId | integer | FK → aiTools.id (restrict) | — |
| tierId | integer | FK → accessTiers.id (restrict) | — |
| costAtAssignmentCents | integer | NOT NULL | — |
| status | enum(active, inactive) | NOT NULL, default: active | — |
| assignedAt | timestamp | NOT NULL, default: now() | **EDITABLE** (retrospective dating) |
| revokedAt | timestamp | nullable | — |
| **workspace** | varchar(200) | nullable | **NEW** |
| **apiKeyEncrypted** | varchar(700) | nullable | **NEW** (AES-256-GCM encrypted) |
| createdAt | timestamp | NOT NULL, default: now() | — |
| updatedAt | timestamp | NOT NULL, default: now() | — |

**New behavior**:
- `assignedAt` can be set to a past date (retrospective dating)
- Validation: `assignedAt` must be ≥ `user.createdAt` AND ≥ `tool.createdAt` AND ≤ now()
- Warning (non-blocking): if `assignedAt` > 12 months in the past
- `tierId` is now editable (in-place mutation), triggering `costAtAssignmentCents` recalculation to new tier's current cost
- All edits recorded in `changeHistory`

**API key security**:
- Column named `apiKeyEncrypted` (never plaintext in DB)
- Encrypted with AES-256-GCM using `API_KEY_ENCRYPTION_SECRET` env var
- Displayed masked (first 4 + `••••••••` + last 4 chars)
- Reveal via server action with re-authorization check

---

## New Entities

### assignmentComments

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | serial | PK | |
| assignmentId | integer | FK → licenseAssignments.id (cascade), indexed | Parent assignment |
| authorId | integer | FK → users.id (restrict), indexed | Who wrote it |
| body | varchar(2000) | NOT NULL | Max 2000 characters per spec |
| createdAt | timestamp | NOT NULL, default: now(), indexed | For chronological sort |
| updatedAt | timestamp | NOT NULL, default: now() | |

**Relationships**:
- `assignmentComments` → `licenseAssignments` (many-to-one, cascade delete)
- `assignmentComments` → `users` (many-to-one, restrict delete)

**Behavior**:
- Comments are append-only from the UI perspective (create, not edit/delete by default)
- Displayed in chronological order (ascending `createdAt`)
- Each comment shows author name and timestamp

---

### billedCosts

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | serial | PK | |
| periodId | integer | FK → budgetPeriods.id (cascade), indexed | Parent budget period |
| amountCents | integer | NOT NULL, positive | Stored in cents |
| invoiceDate | date | NOT NULL, indexed | Calendar date of invoice |
| description | varchar(500) | NOT NULL | e.g. "OpenAI January invoice" |
| vendorReference | varchar(255) | nullable | External invoice number |
| createdAt | timestamp | NOT NULL, default: now() | |
| updatedAt | timestamp | NOT NULL, default: now() | |

**Relationships**:
- `billedCosts` → `budgetPeriods` (many-to-one, cascade delete)

**Behavior**:
- Multiple entries per budget period
- CRUD operations (create, read, update, delete) — all admin-only
- All mutations blocked when parent budget is archived (`annualBudgets.status === "archived"`)
- All mutations recorded in `changeHistory` with `entityType: "billed_cost"`
- Deletion records `previousValue` as JSON snapshot before deleting

---

## Unchanged Entities (behavior changes only)

### accessTiers

No schema changes. Existing `updateTier` action and `updateTierSchema` already support editing name, description, monthlyCostCents, isActive. Enhancement is UI-only (add edit dialog on tool detail page).

**Existing protections preserved**:
- Deactivation blocked when active assignments exist
- All edits recorded in `changeHistory`
- Cost changes do not affect existing assignment snapshots

### annualBudgets / budgetPeriods

No schema changes. New relationship added: `budgetPeriods` → `billedCosts` (one-to-many).

### changeHistory

No schema changes. Existing entity-based audit trail supports all new entity types (`billed_cost`, `assignment_comment`) without modification.

---

## Computed Values (not stored)

| Value | Calculation | Where used |
|-------|------------|------------|
| **Expected costs** (per period) | `SUM(licenseAssignments.costAtAssignmentCents)` where `assignedAt ≤ period.endDate AND (revokedAt IS NULL OR revokedAt ≥ period.startDate)` | Budget detail, reports |
| **Billed total** (per period) | `SUM(billedCosts.amountCents)` where `periodId = period.id` | Budget detail, budget overview |
| **Variance** | `billedTotalCents - expectedSpendCents` | Budget detail, budget overview |
| **Masked API key** | `first4 + "••••••••" + last4` of decrypted value | Assignment detail view |

---

## State Transitions

### License Assignment Editing

```text
                    ┌─────────────────────┐
                    │    Active Assignment │
                    │  (editable fields:   │
                    │   tierId, assignedAt, │
                    │   workspace, apiKey)  │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         Edit tier       Edit meta      Add comment
              │               │               │
    ┌─────────▼─────────┐     │               │
    │ Recalculate cost   │     │               │
    │ snapshot to new    │     │               │
    │ tier's current     │     │               │
    │ monthlyCostCents   │     │               │
    └─────────┬─────────┘     │               │
              │               │               │
              └───────┬───────┘               │
                      │                       │
              Record in changeHistory   Insert assignmentComment
```

### Budget Period Cost Flow

```text
Budget Period
    ├── plannedAmountCents (admin-set allocation)
    ├── expectedSpendCents (calculated from active assignments)
    ├── billedCosts[] (manual entries)
    │   └── billedTotalCents = SUM(amountCents)
    └── variance = billedTotalCents - expectedSpendCents
```

---

## Zod Schemas (new/modified)

### Modified

```typescript
// userSchema — field rename
circle: z.string().min(1, "Circle is required").max(100)

// assignmentSchema — add retrospective dating
assignedAt: z.string().transform(toDate).pipe(notFutureDate).optional()
```

### New

```typescript
// Update assignment
updateAssignmentSchema = z.object({
  id: z.number().int().positive(),
  tierId: z.number().int().positive().optional(),
  assignedAt: assignedAtSchema.optional(),
  workspace: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
})

// Assignment comment
assignmentCommentSchema = z.object({
  assignmentId: z.number().int().positive(),
  body: z.string().min(1).max(2000),
})

// Billed cost CRUD
billedCostSchema = z.object({
  periodId: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  vendorReference: z.string().max(255).optional(),
})

updateBilledCostSchema = z.object({
  id: z.number().int().positive(),
  amountCents: z.number().int().positive().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().min(1).max(500).optional(),
  vendorReference: z.string().max(255).optional().nullable(),
})

deleteBilledCostSchema = z.object({
  id: z.number().int().positive(),
})
```

---

## Type Extensions

```typescript
// ActionResult — add optional warning
type ActionResult<T = void> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

// New types (inferred from schema)
type AssignmentComment = InferSelectModel<typeof assignmentComments>
type NewAssignmentComment = InferInsertModel<typeof assignmentComments>
type BilledCost = InferSelectModel<typeof billedCosts>
type NewBilledCost = InferInsertModel<typeof billedCosts>

// Computed type for budget views
type PeriodWithCosts = BudgetPeriod & {
  expectedSpendCents: number
  billedTotalCents: number
  billedEntries?: BilledCost[]
}
```

---

## Migration Plan

### Migration 1: Rename department → circle
```sql
ALTER TABLE "users" RENAME COLUMN "department" TO "circle";
ALTER INDEX "users_department_idx" RENAME TO "users_circle_idx";
```

### Migration 2: Add assignment meta fields + comments table + billed costs table
```sql
-- Assignment meta fields
ALTER TABLE "license_assignments"
  ADD COLUMN "workspace" varchar(200),
  ADD COLUMN "api_key_encrypted" varchar(700);

-- Assignment comments table
CREATE TABLE "assignment_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "assignment_id" integer NOT NULL REFERENCES "license_assignments"("id") ON DELETE CASCADE,
  "author_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "body" varchar(2000) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "assignment_comments_assignment_id_idx" ON "assignment_comments" ("assignment_id");
CREATE INDEX "assignment_comments_author_id_idx" ON "assignment_comments" ("author_id");
CREATE INDEX "assignment_comments_created_at_idx" ON "assignment_comments" ("created_at");

-- Billed costs table
CREATE TABLE "billed_costs" (
  "id" serial PRIMARY KEY NOT NULL,
  "period_id" integer NOT NULL REFERENCES "budget_periods"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "invoice_date" date NOT NULL,
  "description" varchar(500) NOT NULL,
  "vendor_reference" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "billed_costs_period_id_idx" ON "billed_costs" ("period_id");
CREATE INDEX "billed_costs_invoice_date_idx" ON "billed_costs" ("invoice_date");
```
