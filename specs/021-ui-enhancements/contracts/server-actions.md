# Server Action Contracts: 021-ui-enhancements

**Date**: 2026-03-24

## Modified Actions

### `assignLicense(input)` — Updated

**File**: `src/actions/assignments.ts`

**Current input schema** (`assignmentSchema`):
```
{
  userId: number (positive integer, required)
  toolId: number (positive integer, required)
  tierId: number (positive integer, required)
}
```

**New input schema** (`assignmentSchema` — extended):
```
{
  userId: number (positive integer, required)
  toolId: number (positive integer, required)
  tierId: number (positive integer, required)
  workspace: string (max 200, optional)
  apiKey: string (max 500, optional, trimmed, non-blank if provided)
}
```

**Return type**: Unchanged — `{ success: true, data: { id: number } } | { success: false, error: string }`

**Behavior changes**:
- If `workspace` provided: stored in `license_assignments.workspace`
- If `apiKey` provided: encrypted via `encryptApiKey()` and stored in `license_assignments.apiKeyEncrypted`
- Both fields remain optional — omitting them preserves current behavior

---

### `updateAssignment(input)` — Updated

**File**: `src/actions/assignments.ts`

**Input schema**: Unchanged (`updateAssignmentSchema`)

**Return type**: Unchanged — `{ success: true, data: void, warning?: string } | { success: false, error: string }`

**Behavior changes**:
- **Removed**: Validation that `assignedAt` cannot be before `user.createdAt`
- **Kept**: Validation that `assignedAt` cannot be in the future
- **Kept**: Validation that `assignedAt` cannot be before `tool.createdAt`
- **Kept**: Warning for dates more than 12 months in the past

## Unchanged Actions

- `getAssignmentsForUser(userId)` — no changes
- `revokeAssignment(id)` — no changes
- `reactivateAssignment(id)` — no changes
- `getToolWithTiers(toolId)` — no changes
