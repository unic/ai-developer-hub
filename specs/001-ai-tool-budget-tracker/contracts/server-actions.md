# Server Action Contracts: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02

All Server Actions follow a consistent response pattern:

```typescript
type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
```

All mutation actions require `role === 'admin'`. Unauthorized calls return `{ success: false, error: 'Unauthorized' }`.

---

## Tool Actions (`src/actions/tools.ts`)

### createTool

**Input**: `{ name: string, vendor: string, description?: string, maxLicenses?: number }`
**Output**: `ActionResult<{ id: number }>`
**Auth**: Admin only
**Side effects**: Creates change_history record
**Revalidates**: `/tools`

### updateTool

**Input**: `{ id: number, name?: string, vendor?: string, description?: string, maxLicenses?: number }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: Tool must exist
**Side effects**: Creates change_history record per changed field
**Revalidates**: `/tools`, `/tools/[id]`

### archiveTool

**Input**: `{ id: number }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: Tool must have zero active license assignments (FR-019)
**Side effects**: Creates change_history record
**Revalidates**: `/tools`

---

## Access Tier Actions (`src/actions/tools.ts`)

### createTier

**Input**: `{ toolId: number, name: string, description?: string, monthlyCostCents: number }`
**Output**: `ActionResult<{ id: number }>`
**Auth**: Admin only
**Validation**: Tier name must be unique within tool
**Side effects**: Creates change_history record
**Revalidates**: `/tools/[toolId]`

### updateTier

**Input**: `{ id: number, name?: string, description?: string, monthlyCostCents?: number, isActive?: boolean }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: Tier must exist. Cost change only affects future assignments (FR-020)
**Side effects**: Creates change_history record per changed field
**Revalidates**: `/tools/[toolId]`

---

## User Actions (`src/actions/users.ts`)

### createUser

**Input**: `{ name: string, email: string, passwordHash: string, githubUsername?: string, department: string, role: 'admin' | 'viewer' }`
**Output**: `ActionResult<{ id: number }>`
**Auth**: Admin only
**Validation**: Email must be unique, valid format
**Side effects**: Creates change_history record
**Revalidates**: `/users`

### updateUser

**Input**: `{ id: number, name?: string, email?: string, githubUsername?: string, department?: string, role?: 'admin' | 'viewer' }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: User must exist. Email uniqueness check if changed.
**Side effects**: Creates change_history record per changed field
**Revalidates**: `/users`, `/users/[id]`

### deactivateUser

**Input**: `{ id: number }`
**Output**: `ActionResult<{ revokedCount: number }>`
**Auth**: Admin only
**Validation**: User must exist and be active
**Side effects**: Revokes all active license assignments (FR-007), creates change_history records
**Transaction**: Yes (user deactivation + all license revocations must be atomic)
**Revalidates**: `/users`, `/users/[id]`, `/assignments`

### bulkImportUsers

**Input**: `{ users: Array<{ name: string, email: string, department: string, role?: 'admin' | 'viewer', githubUsername?: string }> }`
**Output**: `ActionResult<{ imported: number, failed: number, errors: Array<{ row: number, email: string, error: string }> }>`
**Auth**: Admin only
**Validation**: Each user validated independently. Valid users imported; invalid users reported (FR-018)
**Side effects**: Creates change_history record per imported user
**Revalidates**: `/users`

---

## Assignment Actions (`src/actions/assignments.ts`)

### assignLicense

**Input**: `{ userId: number, toolId: number, tierId: number }`
**Output**: `ActionResult<{ id: number }>`
**Auth**: Admin only
**Validation**:
- User must exist and be active
- Tool must exist and be active
- Tier must exist, be active, and belong to the tool
- License capacity check: active assignments for tool < maxLicenses (FR-006)
- If user already has an active assignment for this tool, deactivate it first (upgrade/downgrade)
**Side effects**: Snapshots `cost_at_assignment_cents` from tier. Creates change_history record.
**Transaction**: Yes (deactivate old + create new must be atomic for upgrades)
**Revalidates**: `/assignments`, `/users/[userId]`, `/tools/[toolId]`

### revokeLicense

**Input**: `{ id: number }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: Assignment must exist and be active
**Side effects**: Sets `status = 'inactive'`, `revoked_at = now()`. Creates change_history record.
**Revalidates**: `/assignments`, `/users/[userId]`, `/tools/[toolId]`

---

## Budget Actions (`src/actions/budget.ts`)

### createBudget

**Input**: `{ fiscalYear: number, totalAmountCents: number, periodType: 'monthly' | 'quarterly' }`
**Output**: `ActionResult<{ id: number }>`
**Auth**: Admin only
**Validation**: Fiscal year must not already have an active budget
**Side effects**: Auto-generates 12 (monthly) or 4 (quarterly) budget periods with zero allocations. Archives any previous year's budget (FR-021). Creates change_history record.
**Transaction**: Yes (budget creation + period generation + archival must be atomic)
**Revalidates**: `/budget`

### updateBudgetAllocations

**Input**: `{ budgetId: number, allocations: Array<{ periodId: number, plannedAmountCents: number }> }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**:
- Budget must exist and be active (not archived)
- Sum of all period allocations must not exceed `totalAmountCents` (FR-010)
- Each `plannedAmountCents` must be >= 0
**Side effects**: Creates change_history records per changed period
**Revalidates**: `/budget`, `/budget/[budgetId]`

### updateBudgetTotal

**Input**: `{ budgetId: number, totalAmountCents: number }`
**Output**: `ActionResult<void>`
**Auth**: Admin only
**Validation**: Budget must be active. New total must be >= sum of existing period allocations.
**Side effects**: Creates change_history record
**Revalidates**: `/budget`, `/budget/[budgetId]`

---

## History Actions (`src/actions/history.ts`)

### getHistory

**Input**: `{ entityType: string, entityId: number, limit?: number, offset?: number }`
**Output**: `ActionResult<{ records: ChangeHistoryRecord[], total: number }>`
**Auth**: Admin or Viewer (read-only)
**Notes**: This is a read action, but defined as a Server Action for consistency. Could also be a direct DB query in a Server Component.
