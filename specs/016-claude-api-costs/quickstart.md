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
4. **User API Keys**: Each user whose costs you want to track needs an Anthropic API key stored in their license assignment. The corresponding `api_key_id` is resolved automatically at first sync by decrypting the stored key and matching it against the Anthropic Admin API's key list — no manual ID entry is needed.

## Setup Steps

1. **Apply database migration**:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```
   This adds the `anthropic_usage_metrics` and `anthropic_sync_status` tables.

2. **Configure environment**:
   ```bash
   # Add to .env.local
   ANTHROPIC_ADMIN_API_KEY=sk-ant-admin01-your-key-here
   ```

3. **Assign API Keys** (if not already done):
   - Navigate to a user's license assignment for the Claude/Anthropic tool
   - Enter their API key (the system already supports this via the existing assignment edit UI)
   - The Anthropic `api_key_id` is resolved automatically at first sync — no manual ID entry needed

4. **Configure cron job**:
   Configure an external cron service to call the sync endpoint on the desired schedule (e.g., daily):
   ```bash
   POST https://<your-domain>/api/anthropic/sync
   Authorization: Bearer <CRON_SECRET>
   ```
   Uses the same `CRON_SECRET` as the existing Copilot sync.

5. **Verify**:
   - Log in as a user with a configured API Key ID
   - Navigate to Profile (sidebar footer → user dropdown → "My Profile")
   - Verify cost data loads for the current month

## New Files

```
src/
├── app/profile/
│   ├── page.tsx                      # Profile page (server component)
│   └── profile-client.tsx            # Profile client component
├── app/api/anthropic/sync/
│   └── route.ts                      # Cron endpoint: POST /api/anthropic/sync
├── lib/
│   └── anthropic-sync.ts             # Sync orchestrator (mirrors copilot-sync.ts)
├── actions/
│   └── anthropic-usage.ts            # Server actions for cost data + admin manual sync
├── components/
│   ├── profile/
│   │   ├── profile-header.tsx        # Read-only user info display
│   │   ├── profile-assignments.tsx   # Read-only tool assignments
│   │   └── cost-tracking-section.tsx # Monthly total + daily chart
│   └── cost-chart.tsx                # Recharts daily cost chart
└── lib/
    ├── anthropic-pricing.ts          # Model pricing lookup table
    └── anthropic-keys.ts             # API key ID resolution (decrypt → list → match)

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
├── lib/db/schema.ts                  # Add anthropic_usage_metrics + anthropic_sync_status tables
├── components/app-sidebar.tsx        # Add user dropdown with "My Profile" link
└── app/users/[id]/
    ├── page.tsx                      # Fetch cost data for admin view
    └── user-detail-client.tsx        # Add read-only cost section + manual sync button for admins
```

## Key Architecture Decisions

- **Persistent usage history** (not a cache) — follows the `copilot_usage_metrics` pattern. Data stored permanently for long-term cost monitoring.
- **Incremental sync** — detects latest stored date, fetches only new days. Today's data is upserted. Sync runs automatically server-side on stale data; manual trigger is admin-only.
- **Costs computed at sync time** and stored in `computedCostCents`. Prefix-based pricing lookup handles model version suffixes.
- **Admin API key in env var** — single org key, not per-user.
- **Profile at `/profile`** — separate from admin `/users/[id]` route. No user-facing refresh button; data is always served from stored metrics.
