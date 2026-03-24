# Data Model: Profile API

**Feature**: 020-profile-api
**Date**: 2026-03-23

## Schema Changes

**None.** This feature reads from existing tables only. No new tables, columns, or indexes required.

## Existing Entities Used

### users (read-only)

| Field | Type | Used in Response |
|-------|------|-----------------|
| id | serial (PK) | Internal lookup only |
| name | varchar(255) | ✅ `user.name` |
| email | varchar(255), unique index | ✅ Lookup key + `user.email` |
| role | enum (admin/viewer) | ✅ `user.role` |
| circle | varchar(100), nullable | ✅ `user.circle` |
| status | enum (active/inactive) | ✅ `user.status` |
| profile | enum (boost/maxed/indie), nullable | ✅ `user.profile` |

**Lookup**: By email via existing `users_email_idx` unique index.

### license_assignments (read-only)

| Field | Type | Used in Response |
|-------|------|-----------------|
| id | serial (PK) | ✅ `assignments[].id` |
| userId | integer (FK → users) | Join key |
| toolId | integer (FK → ai_tools) | Join key |
| tierId | integer (FK → access_tiers) | Join key |
| status | enum (active/inactive) | Filter (active only) + `assignments[].status` |
| assignedAt | timestamp | ✅ `assignments[].assignedAt` |

**Joins**: `ai_tools` for tool name, `access_tiers` for tier name.

### anthropic_usage_metrics (read-only)

| Field | Type | Used in Response |
|-------|------|-----------------|
| userId | integer (FK → users) | Filter key |
| date | date | ✅ `costData.dailyBreakdown[].date` |
| model | varchar(100) | ✅ `costData.dailyBreakdown[].models[].model` |
| uncachedInputTokens | bigint | Aggregated into inputTokens |
| cacheReadInputTokens | bigint | Aggregated into inputTokens |
| cacheCreationInputTokens | bigint | Aggregated into inputTokens |
| outputTokens | bigint | ✅ `costData.dailyBreakdown[].models[].outputTokens` |
| computedCostCents | integer | ✅ `costData.monthlyTotalCents` (sum) |
| pricingResolved | boolean | ✅ `costData.hasUnresolvedPricing` |

**Filter**: By userId + date range (month boundaries).

## Response Type Structure

```
ProfileApiResponse (success)
├── success: true
├── data
│   ├── user
│   │   ├── name: string
│   │   ├── email: string
│   │   ├── role: "admin" | "viewer"
│   │   ├── circle: string | null
│   │   ├── profile: "boost" | "maxed" | "indie" | null
│   │   └── status: "active" | "inactive"
│   ├── assignments[]
│   │   ├── id: number
│   │   ├── toolName: string
│   │   ├── tierName: string
│   │   ├── assignedAt: string (ISO 8601)
│   │   └── status: "active" | "inactive"
│   └── costData
│       ├── available: boolean
│       ├── error?: string
│       ├── month: string (YYYY-MM)
│       ├── monthlyTotalCents: number
│       ├── dailyBreakdown[]
│       │   ├── date: string (YYYY-MM-DD)
│       │   ├── models[]
│       │   │   ├── model: string
│       │   │   ├── costCents: number
│       │   │   ├── inputTokens: number
│       │   │   └── outputTokens: number
│       │   └── totalCents: number
│       ├── latestDataDate: string | null
│       └── hasUnresolvedPricing: boolean
```

## Data Flow

```
External Tool → GET /api/profile?email=...&month=...
    ↓
Bearer token validation (PROFILE_API_SECRET)
    ↓
Email validation (Zod)
    ↓
users table lookup by email (unique index)
    ↓ userId
┌──────────────────┬───────────────────────┐
│ fetchProfileData │ fetchUserCostData     │
│ (users + joins)  │ (anthropic_usage_     │
│                  │  metrics + joins)     │
└──────────────────┴───────────────────────┘
    ↓
Assemble ProfileApiResponse
    ↓
Return JSON
```
