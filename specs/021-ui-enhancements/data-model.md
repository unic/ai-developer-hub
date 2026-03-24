# Data Model: 021-ui-enhancements

**Date**: 2026-03-24

## Overview

This feature requires **no schema changes**. All database columns needed already exist. The changes are limited to validation logic and UI layer.

## Existing Entities (Reference)

### License Assignment (`license_assignments`)

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| id | serial PK | no | |
| userId | integer FK → users | no | |
| toolId | integer FK → ai_tools | no | |
| tierId | integer FK → access_tiers | no | |
| status | enum (active/inactive) | no | Default: active |
| costAtAssignmentCents | integer | no | Snapshot at assignment time |
| assignedAt | timestamp | no | Default: now() |
| revokedAt | timestamp | yes | Set when revoked |
| workspace | varchar(200) | yes | **Already exists — adding to create flow** |
| apiKeyEncrypted | varchar(700) | yes | **Already exists — adding to create flow** |
| source | varchar(50) | no | Default: "manual" |
| createdAt | timestamp | no | Auto |
| updatedAt | timestamp | no | Auto |

### Validation Rules (Changes)

| Rule | Current | After Change |
|------|---------|-------------|
| assignedAt < user.createdAt | **Error: rejected** | **Allowed** |
| assignedAt > now() | Error: rejected | Error: rejected (unchanged) |
| assignedAt < tool.createdAt | Error: rejected | Error: rejected (unchanged) |
| assignedAt > 12 months ago | Warning | Warning (unchanged) |

### Zod Schema Changes

**`assignmentSchema`** (create flow) — add optional fields:
- `workspace`: string, max 200, optional
- `apiKey`: string, max 500, optional (same refinement as updateAssignmentSchema)

**`updateAssignmentSchema`** (edit flow) — no changes needed.

## State Transitions

No new state transitions. The existing active → inactive (revoked) flow is unchanged.

## Relationships

No relationship changes. The existing foreign keys (user, tool, tier) remain the same.
