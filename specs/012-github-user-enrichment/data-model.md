# Data Model: GitHub User Enrichment

**Feature Branch**: `012-github-user-enrichment`
**Date**: 2026-03-06

## New Tables

### `github_connections`

Stores the active GitHub organization connection. Only one row active at a time (FR-015).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK | Auto-increment ID |
| orgLogin | varchar(255) | NOT NULL | GitHub organization login (e.g., "unic") |
| orgId | integer | NOT NULL | GitHub organization numeric ID |
| orgAvatarUrl | varchar(500) | nullable | Organization avatar URL |
| tokenEncrypted | varchar(700) | NOT NULL | AES-256-GCM encrypted Classic PAT |
| tokenScopesCsv | varchar(255) | NOT NULL | Comma-separated scopes confirmed at connection time |
| status | enum | NOT NULL, default "active" | "active" or "disconnected" |
| connectedBy | integer | NOT NULL, FK → users.id | Admin who created the connection |
| connectedAt | timestamp | NOT NULL, default now() | When connection was established |
| disconnectedAt | timestamp | nullable | When connection was disconnected |
| lastSyncAt | timestamp | nullable | When the last successful sync completed |

**Indexes**: status (for quick active lookup)

**Enum**: `githubConnectionStatusEnum` = ["active", "disconnected"]

**Lifecycle**:
- Created when admin connects an org → status = "active"
- When admin disconnects → status = "disconnected", disconnectedAt = now(), token cleared
- When admin reconnects (same or different org) → old row disconnected, new row created
- Only one row with status "active" at any time

---

### `github_profiles`

Cached GitHub profile data enriching existing users. One row per user (1:1 with users).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK | Auto-increment ID |
| userId | integer | NOT NULL, FK → users.id, UNIQUE | The system user this profile enriches |
| githubId | integer | NOT NULL | GitHub numeric user ID |
| githubLogin | varchar(255) | NOT NULL | GitHub username at time of last sync |
| avatarUrl | varchar(500) | nullable | GitHub avatar URL |
| bio | text | nullable | GitHub bio |
| publicRepos | integer | nullable | Number of public repositories |
| profileUrl | varchar(500) | nullable | GitHub profile URL (html_url) |
| name | varchar(255) | nullable | GitHub display name |
| email | varchar(255) | nullable | GitHub public email |
| lastSyncedAt | timestamp | NOT NULL, default now() | When this profile was last refreshed |
| createdAt | timestamp | NOT NULL, default now() | When first synced |
| updatedAt | timestamp | NOT NULL, default now() | When last modified |

**Indexes**: userId (unique), githubId, githubLogin

**Lifecycle**:
- Created during first sync when a GitHub member is matched to a system user
- Updated on subsequent syncs if any field values changed
- Retained when organization is disconnected (FR-011)
- Deleted only if admin explicitly removes the GitHub link (not in current scope)

---

### `github_sync_events`

Audit log of sync operations.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK | Auto-increment ID |
| connectionId | integer | NOT NULL, FK → github_connections.id | Which connection was synced |
| triggeredBy | integer | NOT NULL, FK → users.id | Admin who triggered the sync |
| status | enum | NOT NULL | "in_progress", "completed", "partial", "failed" |
| totalMembers | integer | nullable | Total GitHub org members fetched |
| matchedCount | integer | nullable | Members matched to existing users |
| importedCount | integer | nullable | Members imported as new users |
| unmatchedCount | integer | nullable | Members not matched or imported |
| conflictCount | integer | nullable | Match conflicts flagged for review |
| errorMessage | text | nullable | Error details if failed/partial |
| startedAt | timestamp | NOT NULL, default now() | When sync started |
| completedAt | timestamp | nullable | When sync finished |

**Enum**: `githubSyncStatusEnum` = ["in_progress", "completed", "partial", "failed"]

**Lifecycle**:
- Created when admin triggers sync → status = "in_progress"
- Updated as sync progresses (counts populated)
- Finalized → status = "completed", "partial", or "failed"

---

## Modified Tables

### `users` (existing)

No schema changes needed. The existing `githubUsername` field (varchar 255, nullable) serves as the primary matching key. GitHub enrichment data is stored in the separate `github_profiles` table.

---

## Relationships

```text
users 1 ←──→ 1 github_profiles       (enrichment data)
users 1 ←──→ N github_connections     (connectedBy)
users 1 ←──→ N github_sync_events     (triggeredBy)
github_connections 1 ←──→ N github_sync_events  (which connection)
```

## State Transitions

### GitHub Connection

```text
[none] → active (admin connects org)
active → disconnected (admin disconnects)
disconnected → [new active row] (admin reconnects)
```

### Sync Event

```text
[created] → in_progress (sync started)
in_progress → completed (all members processed successfully)
in_progress → partial (some members processed, rate limit or errors on others)
in_progress → failed (token invalid, network error, etc.)
```
