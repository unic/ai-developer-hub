# Server Action Contracts: Bulk User Import with Upsert

**Feature**: 011-user-import | **Date**: 2026-03-06

## Modified: `bulkImportUsers`

**File**: `src/actions/users.ts`
**Auth**: Requires admin role

### Input

```typescript
{
  users: Array<{
    name: string;           // Required, non-empty
    email: string;          // Required, valid email format
    circle?: string;        // Optional department/team
    role?: "admin" | "viewer";  // Optional, defaults to "viewer"
    githubUsername?: string; // Optional GitHub handle
    profile?: "boost" | "maxed" | "indie";  // Optional profile tier
  }>;
}
```

### Output (Success)

```typescript
{
  success: true;
  data: {
    created: number;    // New users inserted
    updated: number;    // Existing users with field changes applied
    skipped: number;    // Existing users with no field changes
    failed: number;     // Rows that failed validation/DB
    errors: Array<{
      row: number;      // 1-based row index
      email: string;    // Email from row
      error: string;    // Human-readable error
    }>;
  };
}
```

### Output (Failure)

```typescript
{
  success: false;
  error: string;  // e.g., "Unauthorized" or system error
}
```

### Behavior

1. Validate each row against `bulkImportUserSchema`
2. For each valid row, query existing user by email (case-insensitive)
3. **If no existing user**: Create new user with default password hash, record creation in history
4. **If existing user found**: Compare importable fields (name, circle, role, githubUsername, profile). If any differ, update the user and record field-level changes in history. If all match, skip.
5. Password, status, preferences are never modified for existing users
6. Return aggregate counts and error details

---

## New: `checkExistingUsers`

**File**: `src/actions/users.ts`
**Auth**: Requires admin role

### Input

```typescript
{
  emails: string[];  // List of emails to check
}
```

### Output (Success)

```typescript
{
  success: true;
  data: Record<string, {
    name: string;
    circle: string | null;
    role: string;
    githubUsername: string | null;
    profile: string | null;
  }>;
  // Map of lowercase email → current field values
  // Only includes emails that match existing users
}
```

### Output (Failure)

```typescript
{
  success: false;
  error: string;
}
```

### Behavior

1. Accept list of emails from parsed CSV
2. Query users table for all matching emails (case-insensitive, single query using `inArray`)
3. Return map of email → current importable field values
4. Emails not found in DB are omitted from the map (these are "New" rows)

---

## Unchanged: `GET /api/export/users`

**File**: `src/app/api/export/users/route.ts`
**Auth**: Requires admin role

No changes to this endpoint. The existing CSV export with columns `name, email, circle, role, github_username, profile` is already round-trip compatible with the import.
