# Quickstart: Bulk Data Export (Round-Trip)

**Feature Branch**: `005-bulk-export`
**Date**: 2026-03-05

## What This Feature Does

Adds CSV export buttons to the bulk import pages for license assignments and users. Exported files use the exact same format as the import, enabling a round-trip workflow: export → edit in spreadsheet → re-import.

## Key Files to Create

1. **`src/app/api/export/assignments/route.ts`** — API route handler for assignment CSV export
2. **`src/app/api/export/users/route.ts`** — API route handler for user CSV export
3. **`src/lib/csv.ts`** — Shared CSV generation utility (RFC 4180 escaping)

## Key Files to Modify

1. **`src/app/assignments/import/bulk-assignment-import-form.tsx`** — Add export button
2. **`src/app/users/import/bulk-import-form.tsx`** — Add export button
3. Alternatively, add the export button at the page level (`page.tsx`) if the form components shouldn't own the export action.

## Implementation Order

1. Create `src/lib/csv.ts` — CSV escaping and row generation utility
2. Create assignment export API route (`/api/export/assignments`)
3. Create user export API route (`/api/export/users`)
4. Add export buttons to both import pages
5. Write tests for CSV generation and export endpoints

## Critical Patterns

- **Auth**: Use `requireAdmin()` from `src/lib/auth-helpers.ts` in API route handlers
- **Crypto**: Use `decryptApiKey()` from `src/lib/crypto.ts` for API key decryption
- **Dates**: Use `date-fns` `format(date, "yyyy-MM-dd")` for consistent date formatting
- **Response**: Return `new Response(csvContent, { headers })` with `Content-Type: text/csv` and `Content-Disposition: attachment`
- **BOM**: Prepend `\uFEFF` to CSV content for Excel compatibility
- **Null handling**: Convert null/undefined to empty string `""` — never output "null" or "undefined"

## Database Queries

**Assignments**: Single query joining `licenseAssignments` → `users` (email), `aiTools` (name), `accessTiers` (name)

**Users**: Simple `SELECT` from `users` table — all fields map directly to CSV columns

## Testing Strategy

- Unit test `src/lib/csv.ts` for escaping edge cases (commas, quotes, newlines, null values)
- Integration test export endpoints return valid CSV with correct headers
- Round-trip test: export → parse with import validator → verify zero errors
