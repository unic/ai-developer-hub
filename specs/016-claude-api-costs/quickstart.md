# Quickstart: Claude API Cost Tracking

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16

## Prerequisites

1. **Anthropic Admin API Key**: Obtain an Admin API key from Claude Console (`/settings/admin-keys`). Requires organization admin access.
2. **Environment Setup**: Add to `.env.local`:
   ```
   ANTHROPIC_ADMIN_API_KEY=sk-ant-admin01-...
   ```
3. **Database**: Neon PostgreSQL instance (existing project database).
4. **User API Key IDs**: Each user whose costs you want to track needs their Anthropic `api_key_id` stored in their license assignment. This can be found in Claude Console under API Keys.

## Setup Steps

1. **Apply database migration**:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```
   This adds the `anthropic_usage_metrics` table and `anthropic_api_key_id` column to `license_assignments`.

2. **Configure environment**:
   ```bash
   # Add to .env.local
   ANTHROPIC_ADMIN_API_KEY=sk-ant-admin01-your-key-here
   ```

3. **Assign API Key IDs**:
   - Navigate to a user's license assignment for Claude/Anthropic tool
   - Enter their Anthropic API Key ID (found in Claude Console → API Keys)
   - Save the assignment

4. **Verify**:
   - Log in as a user with a configured API Key ID
   - Navigate to Profile (sidebar footer → user dropdown → "My Profile")
   - Verify cost data loads for the current month

## New Files

```
src/
├── app/profile/
│   ├── page.tsx                      # Profile page (server component)
│   └── profile-client.tsx            # Profile client component
├── actions/
│   └── anthropic-usage.ts            # Server actions for cost data
├── components/
│   ├── profile/
│   │   ├── profile-header.tsx        # Read-only user info display
│   │   ├── profile-assignments.tsx   # Read-only tool assignments
│   │   └── cost-tracking-section.tsx # Monthly total + daily chart
│   └── cost-chart.tsx                # Recharts daily cost chart
└── lib/
    └── anthropic-pricing.ts          # Model pricing lookup table

specs/016-claude-api-costs/          # (already exists)
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── anthropic-usage-api.md
```

## Modified Files

```
src/
├── lib/db/schema.ts                  # Add anthropic_usage_metrics table + license_assignments field
├── lib/validators.ts                 # Add anthropicApiKeyId to assignment schema
├── components/app-sidebar.tsx        # Add user dropdown with "My Profile" link
├── app/users/[id]/
│   ├── page.tsx                      # Fetch cost data for admin view
│   └── user-detail-client.tsx        # Add read-only cost section for admins
└── actions/assignments.ts            # Support anthropicApiKeyId in assignment updates
```

## Key Architecture Decisions

- **Persistent usage history** (not a cache) — follows the `copilot_usage_metrics` pattern. Data stored permanently for long-term cost monitoring.
- **Incremental sync** — detects latest stored date, fetches only new days. Today's data is upserted.
- **Costs computed at read time** from stored token counts × pricing table. Pricing updates apply retroactively.
- **Admin API key in env var** — single org key, not per-user.
- **Profile at `/profile`** — separate from admin `/users/[id]` route.
