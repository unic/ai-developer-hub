# Research: Bulk User Import with Upsert & Export

**Feature**: 011-user-import | **Date**: 2026-03-06

## R-001: Upsert Strategy for Bulk Import

**Decision**: Modify the existing `bulkImportUsers` server action to detect existing users by email and update their non-sensitive fields instead of skipping them.

**Rationale**: The current implementation already queries for existing users by email (line 237-243 of `src/actions/users.ts`) but skips them with an error. Changing this to an update path is a minimal, low-risk modification. Using Drizzle's `update().set().where()` keeps the implementation consistent with the existing `updateUser` action.

**Alternatives considered**:
- PostgreSQL `ON CONFLICT DO UPDATE` (upsert at DB level): Rejected because we need to compute field-level diffs for change history before writing, and we need to preserve `passwordHash` and `status` which requires reading the existing record first.
- New separate "bulk update" action: Rejected per Simplicity principle — one action handling both create and update is simpler and matches the user's mental model.

## R-002: Change Detection for Skip Logic

**Decision**: Compare each importable field (name, circle, role, githubUsername, profile) between the CSV row and the existing database record. If all fields match, skip the row. Use simple string comparison with null normalization (empty string → null for nullable fields).

**Rationale**: This prevents unnecessary database writes and change history noise when re-importing an unmodified export. The comparison is cheap (in-memory, 5 fields) and avoids the complexity of checksums or hashing.

**Alternatives considered**:
- Hash-based comparison: Rejected as over-engineering for 5 fields.
- Always update regardless of changes: Rejected because it creates misleading change history entries and unnecessary DB writes.

## R-003: Preview Enhancement — New vs Update Detection

**Decision**: After CSV parsing on the client, send parsed emails to a new server action `checkExistingUsers` that returns a set of existing emails. The client uses this to label rows as "New" or "Update" in the preview. For "Update" rows, the server also returns current field values so the client can highlight changed fields.

**Rationale**: The client cannot determine New vs Update without querying the database. A lightweight lookup action (single query, returns email→fields map) is efficient and keeps the preview responsive. This is preferable to doing all detection server-side because the preview needs to be interactive (user sees labels before clicking import).

**Alternatives considered**:
- Client-side only detection (no server call): Impossible — client doesn't have access to current user data.
- Full server-side preview rendering: Rejected because the existing preview is client-side and this would require a major architectural change.
- Fetch all users on page load: Viable but wasteful for large user sets and exposes data unnecessarily. The targeted lookup by email list is more efficient and secure.

## R-004: Export Button Placement on User Overview Page

**Decision**: Add an export button (Download icon, outline variant) to the existing admin button group on `src/app/users/page.tsx`, positioned before the "Bulk Import" button. Use a standard `<a>` tag styled as a shadcn Button linking to the existing `/api/export/users` endpoint.

**Rationale**: The export API route already exists and works correctly. The button group on the user overview page already has a flex layout with gap-2 spacing. Adding one more button requires no structural changes. Using an `<a>` tag (not a fetch call) triggers the browser's native download behavior, which is the expected UX for file downloads.

**Alternatives considered**:
- Client-side CSV generation: Rejected — the server-side export already exists with proper RFC 4180 formatting and UTF-8 BOM.
- Dropdown menu with export options: Over-engineering — there's only one export format (CSV).

## R-005: Change History Recording for Bulk Updates

**Decision**: Reuse the existing `recordUpdate` function from `src/actions/history.ts` for each user updated during bulk import. Compute the diff object (field → {old, new}) by comparing the existing record with the CSV values, then pass it to `recordUpdate`.

**Rationale**: The `recordUpdate` function already handles per-field change tracking with JSON-stringified values. Reusing it ensures consistency with single-user edit history and requires no new infrastructure.

**Alternatives considered**:
- Batch history recording: Could be more efficient for large imports, but adds complexity and the existing per-record approach works fine for the expected scale (10-500 users).
- New "bulk_update" change type: Rejected — using the existing "updated" type keeps the history unified and queryable.

## R-006: Import Result Types

**Decision**: Extend the import result to include four categories: `created` (count), `updated` (count), `skipped` (count, no changes), `failed` (count + error details). Update the `ActionResult` data type for `bulkImportUsers` accordingly.

**Rationale**: The spec requires distinct reporting of create vs update vs skip vs fail. The existing result only has `imported` and `failed`. Expanding this is a backward-compatible change since the UI is the only consumer.

**Alternatives considered**:
- Keep existing two-category result and add update info to errors: Confusing UX — updates aren't errors.
- Return full row-level details: Over-engineering for the summary toast display.
