# UI Contracts: Bulk License Import & Profile

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05

## New Pages

### Bulk Assignment Import Page

**Route**: `/assignments/import`
**Access**: Admin only
**Components**: `src/app/assignments/import/page.tsx` (server) + `bulk-assignment-import-form.tsx` (client)

**Page structure**:
1. Header: "Bulk Import License Assignments"
2. Description: CSV column requirements
3. File upload card (CSV only)
4. Preview table (shown after file selected):
   - Columns: Email, Tool, Tier, Workspace, API Key (masked/truncated), Assigned At, Status (Valid/Error badge)
   - Invalid rows highlighted with `bg-destructive/10`
   - Summary line: "{valid} valid, {invalid} invalid of {total} total"
5. Action buttons: "Import {N} Assignment(s)" + "Cancel"
6. Post-import: toast summary with counts

**CSV columns**: `email`, `tool`, `tier`, `workspace`, `api_key`, `assigned_at`

---

## Modified Components

### Assignment Detail Page — API Key Edit

**File**: `src/app/assignments/[id]/assignment-detail-client.tsx`

**Changes** (admin only):
- Add "Set API Key" / "Update API Key" input field with save button in the API key section
- When no API key exists: show input + "Save" button
- When API key exists: show existing masked key + reveal/copy controls + "Update" expand/input
- "Clear API Key" button to remove the key
- Uses existing `updateAssignment` action with `apiKey` field

### User Detail Page — Profile Field

**File**: `src/app/users/[id]/user-detail-client.tsx`

**Changes**:
- Add `profile` field to the edit form as a `<Select>` dropdown
- Options: (empty/"None"), Boost, Maxed, Indie
- Displayed in the user header area as a Badge when set

### New User Form — Profile Field

**File**: `src/app/users/new/new-user-form.tsx`

**Changes**:
- Add `profile` field as optional `<Select>` dropdown after the role field
- Options: (empty/"None"), Boost, Maxed, Indie
- Default: no selection (empty)

### Users Table — Profile Column

**File**: `src/app/users/users-table.tsx`

**Changes**:
- Add "Profile" column to the table
- Display profile value as Badge when set, "—" when null
- Filterable if existing table has column filters

### Bulk User Import Form — Profile Column

**File**: `src/app/users/import/bulk-import-form.tsx`

**Changes**:
- Parse `profile` column from CSV
- Validate against allowed values (boost/maxed/indie, case-insensitive)
- Show in preview table
- Pass to `bulkImportUsers` action

---

## Navigation

Add "Import Assignments" link/button to the assignments page, following the same pattern as the "Import Users" button on the users page.
