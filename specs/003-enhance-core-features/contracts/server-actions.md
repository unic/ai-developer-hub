# Server Actions Contract: Enhance Core Features

All server actions follow the existing `ActionResult<T>` pattern:
```typescript
type ActionResult<T = void> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }
```

---

## Assignment Actions (`src/actions/assignments.ts`)

### updateAssignment

**Purpose**: Edit an existing active license assignment (tier change, meta fields, retrospective date).

```typescript
export async function updateAssignment(input: unknown): Promise<ActionResult<void>>
```

**Input** (`updateAssignmentSchema`):
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | number | yes | Assignment ID |
| tierId | number | no | New tier (must belong to same tool, be active) |
| assignedAt | string (ISO date) | no | Retrospective date (validated server-side) |
| workspace | string | no | Max 200 chars |
| apiKey | string | no | Max 500 chars (encrypted before storage) |

**Authorization**: Admin only (`requireAdmin()`).

**Behavior**:
- Rejects if assignment is inactive
- On tier change: updates `costAtAssignmentCents` to new tier's `monthlyCostCents`
- On `assignedAt` change: validates ≥ user.createdAt, ≥ tool.createdAt, ≤ now()
- Returns `warning` if `assignedAt` > 12 months in past
- Records all changed fields in `changeHistory`
- API key history entries use `[redacted]` for old/new values
- Revalidates `/assignments` and `/users/{userId}`

---

### revealApiKey

**Purpose**: Decrypt and return the full API key for an assignment.

```typescript
export async function revealApiKey(assignmentId: number): Promise<ActionResult<{ plaintext: string }>>
```

**Authorization**: Admin only (`requireAdmin()`).

**Behavior**:
- Returns `{ success: false }` if no API key stored
- Decrypts `apiKeyEncrypted` using `decryptApiKey()` from `src/lib/crypto.ts`
- Does NOT log the plaintext in change history

---

### addAssignmentComment

**Purpose**: Add a timestamped comment to a license assignment.

```typescript
export async function addAssignmentComment(input: unknown): Promise<ActionResult<{ id: number }>>
```

**Input** (`assignmentCommentSchema`):
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| assignmentId | number | yes | Must reference existing assignment |
| body | string | yes | 1–2000 characters |

**Authorization**: Admin only (`requireAdmin()`).

**Behavior**:
- Sets `authorId` from session
- Inserts into `assignmentComments` table
- Revalidates assignment detail page

---

### getAssignmentComments

**Purpose**: Fetch all comments for an assignment in chronological order.

```typescript
export async function getAssignmentComments(assignmentId: number): Promise<AssignmentComment[]>
```

**Authorization**: Any authenticated user (viewers can see their own assignment comments).

---

## Budget Actions (`src/actions/budget.ts`)

### createBilledCost

**Purpose**: Add a billed cost entry to a budget period.

```typescript
export async function createBilledCost(input: unknown): Promise<ActionResult<{ id: number }>>
```

**Input** (`billedCostSchema`):
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| periodId | number | yes | FK to budgetPeriods |
| amountCents | number | yes | Positive integer (cents) |
| invoiceDate | string | yes | YYYY-MM-DD format |
| description | string | yes | 1–500 characters |
| vendorReference | string | no | Max 255 characters |

**Authorization**: Admin only.

**Guards**: Rejects if parent budget is archived (`requireActivePeriod()`).

**Behavior**:
- Records creation in `changeHistory` with `entityType: "billed_cost"`
- Revalidates budget detail page

---

### updateBilledCost

**Purpose**: Edit an existing billed cost entry.

```typescript
export async function updateBilledCost(input: unknown): Promise<ActionResult<void>>
```

**Input** (`updateBilledCostSchema`):
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| id | number | yes | Billed cost entry ID |
| amountCents | number | no | Positive integer |
| invoiceDate | string | no | YYYY-MM-DD format |
| description | string | no | 1–500 chars |
| vendorReference | string \| null | no | nullable to clear |

**Authorization**: Admin only.

**Guards**: Rejects if parent budget is archived.

**Behavior**:
- Only records changed fields in `changeHistory`
- Revalidates budget detail page

---

### deleteBilledCost

**Purpose**: Delete a billed cost entry.

```typescript
export async function deleteBilledCost(input: unknown): Promise<ActionResult<void>>
```

**Input** (`deleteBilledCostSchema`):
| Field | Type | Required |
|-------|------|----------|
| id | number | yes |

**Authorization**: Admin only.

**Guards**: Rejects if parent budget is archived.

**Behavior**:
- Records deletion in `changeHistory` with `previousValue` as JSON snapshot (amountCents, invoiceDate, description)
- Then deletes the row
- Revalidates budget detail page

---

### getBudgetWithCosts

**Purpose**: Load a budget with all periods, expected costs, billed totals, and billed entries.

```typescript
export async function getBudgetWithCosts(budgetId: number): Promise<BudgetWithCosts | null>
```

**Return type**:
```typescript
type BudgetWithCosts = AnnualBudget & {
  periods: PeriodWithCosts[]
}
type PeriodWithCosts = BudgetPeriod & {
  expectedSpendCents: number
  billedTotalCents: number
  billedEntries: BilledCost[]
}
```

**Authorization**: Any authenticated user (read-only).

**Behavior**:
- Loads budget + periods via relational query
- Aggregates billed costs per period (single grouped query)
- Calculates expected costs per period (from active assignments)

---

## Terminology Changes

### Renamed actions/functions

| Old name/reference | New name/reference | File |
|---|---|---|
| `getActualSpendForPeriod` | `getExpectedSpendForPeriod` | `src/actions/budget.ts` |
| "Actual" in UI labels | "Expected" | Budget detail, reports |
