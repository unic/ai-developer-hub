# Data Model: 015-github-member-sync

**Date**: 2026-03-10

## Schema Changes

### Modified Table: `githubSyncEvents`

Add two new nullable integer columns:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `manuallyMatchedCount` | integer | null | Number of GitHub members manually matched to existing users during this sync |
| `createdCount` | integer | null | Number of new system users created inline during this sync |

These columns supplement the existing metrics: `matchedCount` (auto-matched), `importedCount` (legacy bulk import), `unmatchedCount`, `conflictCount`.

**Migration**: Single `ALTER TABLE` adding both columns.

### No New Tables

All other data needs are served by existing tables:
- `users.githubUsername` — stores the persistent link (already exists)
- `githubProfiles` — stores enriched GitHub profile data (already exists)
- `changeHistory` — audit trail for all mutations (already exists)

## Client-Side Types (New)

### `PendingResolution`

Represents an admin's decision for a single unmatched GitHub member, held in client state until sync confirmation.

```
PendingResolution =
  | { type: "match", githubLogin: string, userId: number, userName: string }
  | { type: "create", githubLogin: string, name: string, email: string }
  | { type: "skip", githubLogin: string }
```

### `MatchSuggestion`

A ranked candidate match between an unmatched GitHub member and an application user.

```
MatchSuggestion = {
  userId: number
  userName: string
  userEmail: string
  userStatus: "active" | "inactive"
  githubUsername: string | null    // existing link, if any
  score: number                    // 0–1 similarity score
  reason: string                   // e.g., "Name similarity", "Email domain match"
}
```

### `ResolutionSummary`

Aggregated counts for the resolution progress indicator (FR-007).

```
ResolutionSummary = {
  total: number           // total unmatched members
  matched: number         // resolved as "match to existing"
  created: number         // resolved as "create new user"
  skipped: number         // resolved as "skip"
  unresolved: number      // not yet resolved
}
```

## Entity Relationships

```
GitHub Org Member (API)
  │
  ├── Auto-matched → users.githubUsername (existing flow, unchanged)
  │
  └── Unmatched → PendingResolution (client state)
        │
        ├── type: "match" → updates users.githubUsername + upserts githubProfiles
        ├── type: "create" → inserts users row + upserts githubProfiles
        └── type: "skip" → no DB change (recorded in unmatchedCount)
```

## Audit Trail Records

When sync is confirmed, the following `changeHistory` entries are created:

**For manual matches (type: "match")**:
- `entityType`: "user"
- `entityId`: matched user's ID
- `changeType`: "updated"
- `fieldName`: "githubUsername"
- `previousValue`: old value (or null)
- `newValue`: GitHub login

**For inline user creation (type: "create")**:
- `entityType`: "user"
- `entityId`: new user's ID
- `changeType`: "created"
- `fieldName`: null
- `previousValue`: null
- `newValue`: JSON with name, email, githubUsername

## Validation Rules

- A GitHub login can only be matched to one user (enforced by overwrite warning FR-009)
- Email must be unique when creating a new user (validated server-side against existing users)
- Name is required for inline creation (pre-filled from GitHub, editable)
- If GitHub member has no public email, admin must provide one manually
- Temp password ("changeme123") is auto-assigned for inline-created users (consistent with existing import pattern)
