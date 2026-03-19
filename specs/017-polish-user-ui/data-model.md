# Data Model: 017-polish-user-ui

**Date**: 2026-03-17

## Overview

No database schema changes are required for this feature. All changes are UI-only, leveraging existing tables and server actions. This document records the existing data model for reference during implementation.

## Existing Entities (No Changes)

### Users

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| id | serial (PK) | No | |
| name | varchar(255) | No | |
| email | varchar(255) | No | Unique, indexed |
| passwordHash | varchar(255) | No | bcrypt, 12 rounds |
| githubUsername | varchar(255) | Yes | |
| circle | varchar(100) | Yes | Indexed; used for new faceted filter |
| role | enum (admin, viewer) | No | Default: viewer |
| status | enum (active, inactive) | No | Default: active; indexed |
| profile | enum (boost, maxed, indie) | Yes | Used for new faceted filter |
| createdAt | timestamp | No | Auto-set |
| updatedAt | timestamp | No | Auto-set |

**Filter-relevant fields**: `circle` (nullable → needs sentinel), `role`, `status`, `profile` (nullable → needs sentinel)

### License Assignments

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| id | serial (PK) | No | |
| userId | integer (FK → users) | No | Indexed |
| toolId | integer (FK → ai_tools) | No | Indexed; used for new faceted filter |
| tierId | integer (FK → accessTiers) | No | Indexed; used for new faceted filter |
| costAtAssignmentCents | integer | No | Cost snapshot at assignment time |
| status | enum (active, inactive) | No | Default: active; existing faceted filter |
| assignedAt | timestamp | No | Default: now() |
| revokedAt | timestamp | Yes | Set on revocation |
| workspace | varchar(200) | Yes | Used for new faceted filter |
| apiKeyEncrypted | varchar(700) | Yes | Encrypted storage |
| source | varchar(50) | No | Default: "manual"; existing faceted filter |
| createdAt | timestamp | No | |
| updatedAt | timestamp | No | |

**Filter-relevant fields**: `status` (existing), `source` (existing), tool name (via join), tier name (via join), `workspace` (nullable → needs sentinel)

### Anthropic Sync Status

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| id | serial (PK) | No | |
| userId | integer | No | userId=0 is global lock sentinel |
| lastSyncStartedAt | timestamp | Yes | |
| lastSyncCompletedAt | timestamp | Yes | Displayed in new Claude section |
| lastSyncError | varchar(500) | Yes | Displayed in new Claude section |
| syncedDays | integer | No | Default: 0 |

**Settings-relevant fields**: `lastSyncCompletedAt`, `lastSyncError`, `syncedDays` (for Claude Console section display)

## Existing Server Actions (No Changes)

All server actions are reused as-is:

| Action | Used By | Purpose |
|--------|---------|---------|
| `updateUser()` | EditUserDialog | Save inline edits from overview |
| `createUser()` | New user form | Already exists, enhanced form only |
| `assignLicense()` | User detail assign + reactivate | Assign new license or reactivate revoked |
| `updateAssignment()` | Assignment detail inline edit | Save field changes |
| `syncAllAnthropicUsage()` | Claude sync section in settings | Moved from users page |
| `getUsers()` | UserCombobox | Load active users for searchable selection |

## State Transitions

### License Reactivation (New UI Flow, Existing Logic)

```
Revoked Assignment (status=inactive)
  → Admin clicks "Reactivate"
    → Confirmation dialog shown (tool, tier, cost)
      → assignLicense(userId, toolId, tierId) called
        → New Assignment created (status=active, new costAtAssignment)
        → Original revoked assignment unchanged
```

This is not a state change on the existing assignment — it creates a new assignment record. The existing `assignLicense` handles capacity checks and cost snapshots.
