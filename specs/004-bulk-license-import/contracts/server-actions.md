# Server Action Contracts: Bulk License Import & Profile

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05

## New Server Actions

### `bulkImportAssignments`

**Location**: `src/actions/assignments.ts`
**Auth**: Admin only (`requireAdmin()`)

**Input**:
```typescript
{
  assignments: Array<{
    email: string;         // User lookup key
    tool: string;          // Tool name (case-insensitive match)
    tier: string;          // Tier name scoped to tool (case-insensitive match)
    workspace: string;     // Workspace identifier
    apiKey?: string;       // Optional plaintext API key
    assignedAt: string;    // YYYY-MM-DD date string
  }>;
}
```

**Output**:
```typescript
ActionResult<{
  imported: number;
  failed: number;
  errors: Array<{
    row: number;
    email: string;
    error: string;
  }>;
}>
```

**Behavior**:
1. Validate each row with Zod schema
2. Resolve email → user ID (must exist, must be active)
3. Resolve tool name → tool ID (case-insensitive, must be active)
4. Resolve tier name → tier ID (case-insensitive, scoped to tool, must be active)
5. Check for duplicate active assignment (user + tool)
6. For valid rows: insert with `costAtAssignmentCents` from tier, encrypt API key if present, use `assignedAt` from CSV
7. Each row committed individually (best-effort)
8. Return summary with error details per failed row
9. Revalidate `/assignments` path

---

### `updateAssignmentApiKey`

**Note**: Not a new action — uses existing `updateAssignment` in `src/actions/assignments.ts`.

The existing `updateAssignment` already accepts optional `apiKey` field. The UI change is to expose this on the detail page with add/update/clear functionality.

**To clear an API key**: Send `apiKey: ""` (empty string). The action should be updated to handle empty string as "remove API key" by setting `apiKeyEncrypted: null`.

---

## Modified Server Actions

### `createUser` (modified)

**Change**: Accept optional `profile` field.

**New input field**:
```typescript
profile?: "boost" | "maxed" | "indie"
```

### `updateUser` (modified)

**Change**: Accept optional `profile` field, track in change history.

**New input field**:
```typescript
profile?: "boost" | "maxed" | "indie" | null  // null to clear
```

### `bulkImportUsers` (modified)

**Change**: Accept optional `profile` field per user row.

**New input field per row**:
```typescript
profile?: string  // Validated against allowed values
```

**Validation**: If profile value provided, must be one of `boost`, `maxed`, `indie` (case-insensitive). Invalid values cause the row to be marked invalid.

---

## New Zod Schemas

### `bulkImportAssignmentSchema`

**Location**: `src/lib/validators.ts`

```typescript
const bulkImportAssignmentSchema = z.object({
  email: z.string().email(),
  tool: z.string().min(1).max(255),
  tier: z.string().min(1).max(100),
  workspace: z.string().min(1).max(200),
  apiKey: z.string().max(500).optional(),
  assignedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

### Modified `userSchema` / `bulkImportUserSchema`

Add optional profile field:
```typescript
profile: z.enum(["boost", "maxed", "indie"]).optional()
```

### Modified `updateUserSchema`

Add optional nullable profile field:
```typescript
profile: z.enum(["boost", "maxed", "indie"]).nullable().optional()
```
