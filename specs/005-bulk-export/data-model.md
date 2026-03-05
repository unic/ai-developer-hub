# Data Model: Bulk Data Export (Round-Trip)

**Feature Branch**: `005-bulk-export`
**Date**: 2026-03-05

## Overview

This feature introduces **no new database tables or schema changes**. It reads from existing tables and transforms data into CSV format matching the bulk import schemas.

## Existing Entities (Read-Only)

### License Assignments (`licenseAssignments`)

Source table for assignment CSV export. Requires joins to resolve foreign keys.

| DB Field | CSV Column | Transformation |
|----------|------------|----------------|
| `userId` → `users.email` | `email` | JOIN users ON userId = users.id |
| `toolId` → `aiTools.name` | `tool` | JOIN aiTools ON toolId = aiTools.id |
| `tierId` → `accessTiers.name` | `tier` | JOIN accessTiers ON tierId = accessTiers.id |
| `workspace` | `workspace` | Direct (varchar → string) |
| `apiKeyEncrypted` | `api_key` | Decrypt via `decryptApiKey()`, empty string if null |
| `assignedAt` | `assigned_at` | Format as `YYYY-MM-DD` |

**Query scope**: All rows (no status filter). Ordered by `assignedAt` descending for predictable output.

### Users (`users`)

Source table for user CSV export. Direct field mapping, no joins needed.

| DB Field | CSV Column | Transformation |
|----------|------------|----------------|
| `name` | `name` | Direct (varchar → string) |
| `email` | `email` | Direct (varchar → string) |
| `circle` | `circle` | Direct (varchar → string) |
| `role` | `role` | Direct (enum already matches: `admin` / `viewer`) |
| `githubUsername` | `github_username` | Direct, empty string if null |
| `profile` | `profile` | Direct (enum already matches: `boost` / `maxed` / `indie`), empty string if null |

**Query scope**: All rows (no status filter). Ordered by `name` ascending for predictable output.

### Supporting Tables (Join-Only)

- **`aiTools`**: Provides `name` field for tool name resolution in assignment export.
- **`accessTiers`**: Provides `name` field for tier name resolution in assignment export.

## Data Flow

```
Database → Drizzle Query (with joins) → Row transformation → CSV escaping → HTTP Response
```

No data is written back to the database. No new indexes are needed — the existing foreign key indexes support the join queries efficiently.
