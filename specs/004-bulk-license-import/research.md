# Research: Bulk License Import, API Key Management & User Profile Extension

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05

## Research Tasks & Findings

### 1. CSV Parsing Strategy for License Assignments

**Decision**: Client-side CSV parsing with server-side validation (same pattern as existing bulk user import)

**Rationale**: The existing `src/app/users/import/bulk-import-form.tsx` uses `FileReader` + client-side CSV parsing with a preview table. Server-side validation happens in the server action. This pattern provides instant feedback to the admin before any network round-trip and is proven in the codebase.

**Alternatives considered**:
- Server-side CSV parsing via form upload: Rejected — slower feedback loop, no preview before submission
- Third-party CSV library (e.g., Papa Parse): Rejected — simple CSV format doesn't warrant an additional dependency; existing hand-rolled parser works well

### 2. Bulk Import Server Action Pattern

**Decision**: Loop-based best-effort insertion matching the `bulkImportUsers` pattern in `src/actions/users.ts:195-264`

**Rationale**: The existing pattern iterates rows, validates each with Zod, checks for duplicates, inserts individually with try/catch, and collects errors. This is battle-tested in the codebase and matches the clarified requirement (best-effort, row-by-row commits).

**Alternatives considered**:
- Transaction-wrapped batch insert: Rejected per clarification — user chose best-effort over all-or-nothing
- Batch insert with `Promise.allSettled`: Rejected — sequential processing is simpler and avoids thundering-herd on the DB

### 3. Tool/Tier Resolution by Name

**Decision**: Server-side lookup by name (case-insensitive) during the bulk import action, using `ilike` or lowercased comparison via Drizzle

**Rationale**: The CSV provides tool and tier names (not IDs), so the server action must resolve these to IDs. Case-insensitive matching prevents common data entry issues. Drizzle ORM supports `ilike` for PostgreSQL.

**Alternatives considered**:
- Client-side resolution (fetch all tools/tiers, resolve before sending): Rejected — would require exposing tool/tier data to client and adds complexity
- Exact case match: Rejected — too fragile for CSV data entry

### 4. API Key Encryption for Bulk Import

**Decision**: Reuse existing `encryptApiKey()` from `src/lib/crypto.ts`

**Rationale**: The function uses AES-256-GCM with a per-key salt derived from `API_KEY_ENCRYPTION_SECRET`. It's already used in `updateAssignment` for API key updates. No changes needed — just call it during import for rows that have an API key value.

**Alternatives considered**: None — the existing implementation is correct and sufficient.

### 5. Assignment Cost Auto-Population

**Decision**: Look up `accessTiers.monthlyCostCents` for the matched tier and use it as `costAtAssignmentCents`, consistent with `assignLicense` in `src/actions/assignments.ts:114`

**Rationale**: Per clarification, cost is auto-populated from the tier. The existing `assignLicense` action already does `costAtAssignmentCents: tier.monthlyCostCents` on line 114. Same approach.

**Alternatives considered**: CSV cost column — rejected per clarification.

### 6. User Profile Field Implementation

**Decision**: Add a PostgreSQL enum `user_profile` with values `boost`, `maxed`, `indie` and add an optional `profile` column to the `users` table

**Rationale**: Follows the existing pattern of using `pgEnum` for constrained values (see `userRoleEnum`, `userStatusEnum` in schema). The column is nullable to allow existing users to have no profile set. Display values are capitalized in the UI (Boost, Maxed, Indie) while stored lowercase.

**Alternatives considered**:
- VARCHAR with application-level validation only: Rejected — enum provides DB-level constraint
- Separate profile table: Rejected — overkill for a simple classification field

### 7. API Key Edit on Assignment Detail

**Decision**: Extend the existing `updateAssignment` server action (which already handles `apiKey` updates) and add an inline edit form on the assignment detail page

**Rationale**: The `updateAssignment` action at `src/actions/assignments.ts:169-308` already handles API key changes (lines 267-271). The detail page just needs an input field + save button for admins. To clear an API key, send an empty/null value.

**Alternatives considered**:
- Separate `updateApiKey` action: Rejected — `updateAssignment` already handles this field; adding a separate action would be redundant

### 8. Duplicate Active Assignment Detection

**Decision**: During bulk import validation, query for existing active assignments matching user_id + tool_id before insertion

**Rationale**: FR-009 requires flagging duplicates. The existing `assignLicense` action handles this by deactivating the old assignment (upgrade flow). For bulk import, the spec says to flag as invalid rather than auto-upgrade, keeping the import non-destructive.

**Alternatives considered**:
- Auto-upgrade (deactivate old, create new): Rejected — spec explicitly says flag as conflict and skip

## No Unresolved Items

All NEEDS CLARIFICATION items were resolved during the specification clarify phase. No further research needed.
