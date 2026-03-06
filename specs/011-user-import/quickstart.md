# Quickstart: Bulk User Import with Upsert & Export

**Feature**: 011-user-import | **Date**: 2026-03-06

## Prerequisites

- Node.js LTS + pnpm installed
- Neon PostgreSQL database configured (`.env.local` with `DATABASE_URL`)
- Admin user seeded (`pnpm db:seed`)

## Setup

```bash
git checkout 011-user-import
pnpm install
pnpm db:push          # Apply any schema changes (none expected for this feature)
pnpm dev              # Start dev server at http://localhost:3000
```

## Development Workflow

### 1. Modify Server Action (Backend First)

**File**: `src/actions/users.ts`

- Add `checkExistingUsers` action for preview email lookup
- Modify `bulkImportUsers` to support upsert:
  - When email matches existing user → update fields (not password/status)
  - When email is new → create user with default password
  - Track created/updated/skipped/failed counts
  - Record changes in history via `recordUpdate`

### 2. Update Import Form (Frontend)

**File**: `src/app/users/import/bulk-import-form.tsx`

- After CSV parse, call `checkExistingUsers` with parsed emails
- Label each preview row as "New" or "Update"
- For "Update" rows, highlight fields that differ from current values
- Update import summary to show created/updated/skipped/failed

### 3. Add Export Button to User Overview

**File**: `src/app/users/page.tsx`

- Add Download button linking to `/api/export/users`
- Place in admin button group before "Bulk Import"

### 4. Update Types

**File**: `src/types/index.ts`

- Add `BulkImportResult` type (created, updated, skipped, failed, errors)
- Add `ExistingUserFields` type for preview lookup

## Testing

```bash
pnpm test                    # Unit tests
pnpm test:e2e                # E2E tests (requires running dev server)
```

### Manual Testing Workflow

1. Log in as admin
2. Navigate to `/users` — verify export button visible
3. Click export → CSV downloads
4. Open CSV, modify some fields, add new rows
5. Navigate to `/users/import`
6. Upload modified CSV → verify preview shows "New"/"Update" labels
7. Click Import → verify summary shows correct counts
8. Check user records are updated (passwords unchanged)
9. Check change history records exist for updates

## Key Files

| File | Role |
|------|------|
| `src/actions/users.ts` | Server actions (upsert logic) |
| `src/app/users/import/bulk-import-form.tsx` | Import form with preview |
| `src/app/users/page.tsx` | User overview (export button) |
| `src/lib/validators.ts` | Zod schemas |
| `src/types/index.ts` | TypeScript types |
| `src/actions/history.ts` | Change history recording |
| `src/app/api/export/users/route.ts` | CSV export API |
| `src/lib/csv.ts` | CSV utilities |
