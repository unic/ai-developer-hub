# Data Model: Bulk User Import with Upsert & Export

**Feature**: 011-user-import | **Date**: 2026-03-06

## Existing Entities (No Schema Changes)

This feature requires **no database schema changes**. All data model changes are at the application type level.

### Users Table (existing)

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| id | serial | no | Primary key |
| name | varchar(255) | no | Updated via import |
| email | varchar(255) | no | Unique — match key for upsert |
| passwordHash | varchar(255) | no | **Never modified by import** |
| githubUsername | varchar(255) | yes | Updated via import |
| circle | varchar(100) | yes | Updated via import |
| role | enum(admin, viewer) | no | Updated via import (default: viewer) |
| status | enum(active, inactive) | no | **Never modified by import** |
| profile | enum(boost, maxed, indie) | yes | Updated via import |
| preferences | jsonb | no | **Never modified by import** |
| createdAt | timestamp | no | Auto-set on creation |
| updatedAt | timestamp | no | Auto-set on update |

**Import-writable fields**: name, circle, role, githubUsername, profile
**Import-protected fields**: id, email (match key), passwordHash, status, preferences, createdAt, updatedAt

### Change History Table (existing, no changes)

| Field | Type | Notes |
|-------|------|-------|
| id | serial | Primary key |
| entityType | varchar(50) | "user" for user changes |
| entityId | integer | References users.id |
| changeType | enum | "created" or "updated" for import operations |
| fieldName | varchar(100) | Name of changed field |
| previousValue | text | JSON-stringified old value |
| newValue | text | JSON-stringified new value |
| changedBy | integer | Admin performing the import |
| createdAt | timestamp | Auto-set |

## New Application Types

### BulkImportResult

Replaces the existing `{ imported, failed, errors }` return type.

| Field | Type | Description |
|-------|------|-------------|
| created | number | Count of new users created |
| updated | number | Count of existing users updated (with actual changes) |
| skipped | number | Count of existing users with no field changes |
| failed | number | Count of rows that failed validation or DB errors |
| errors | ImportError[] | Details of failed rows |

### ImportError (existing, unchanged)

| Field | Type | Description |
|-------|------|-------------|
| row | number | 1-based row number in CSV |
| email | string | Email from the row (if available) |
| error | string | Human-readable error message |

### ExistingUserMap (new, for preview)

Returned by `checkExistingUsers` action for preview labeling.

| Field | Type | Description |
|-------|------|-------------|
| [email: string] | ExistingUserFields | null | Map of email to current field values |

### ExistingUserFields (new, for preview)

| Field | Type | Description |
|-------|------|-------------|
| name | string | Current name |
| circle | string | null | Current circle |
| role | string | Current role |
| githubUsername | string | null | Current GitHub username |
| profile | string | null | Current profile |

### ParsedImportRow (extended)

Extends existing parsed row with upsert metadata for preview.

| Field | Type | Description |
|-------|------|-------------|
| name | string | From CSV |
| email | string | From CSV |
| circle | string | undefined | From CSV |
| role | string | undefined | From CSV |
| githubUsername | string | undefined | From CSV |
| profile | string | undefined | From CSV |
| action | "new" | "update" | "skip" | Determined after email lookup |
| changes | string[] | List of field names that differ from current values (update rows only) |
| error | string | undefined | Validation error message |

## Field Comparison Logic

For determining whether a row is "update" or "skip":

| CSV Value | DB Value | Result |
|-----------|----------|--------|
| "Engineering" | "Engineering" | No change |
| "Engineering" | "Sales" | Changed |
| "" or undefined | null | No change (normalize empty → null) |
| "" or undefined | "Sales" | Changed (clears field) |
| "Engineering" | null | Changed (sets field) |

**Normalization rule**: Empty strings and undefined values in CSV are treated as `null` for comparison with nullable fields. For non-nullable fields (name, role), empty string triggers a validation error.
