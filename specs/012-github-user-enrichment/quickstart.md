# Quickstart: GitHub User Enrichment

**Feature Branch**: `012-github-user-enrichment`
**Date**: 2026-03-06

## Prerequisites

- Node.js LTS, pnpm
- Neon PostgreSQL database with `DATABASE_URL` configured
- `API_KEY_ENCRYPTION_SECRET` set in `.env.local` (existing requirement)
- A GitHub Classic PAT with `read:org` + `read:user` scopes for testing

## Setup

```bash
# Switch to feature branch
git checkout 012-github-user-enrichment

# Install dependencies (no new packages needed for GitHub REST API — use native fetch)
pnpm install

# Apply schema changes (new tables: github_connections, github_profiles, github_sync_events)
pnpm db:generate
pnpm db:push

# Start dev server
pnpm dev
```

## Feature Walkthrough

### 1. Connect GitHub Organization

1. Log in as admin
2. Navigate to **Settings > Integrations** (`/settings/integrations`)
3. Enter your Classic PAT in the token field
4. Click **Validate** — system checks scopes and lists available organizations
5. Select an organization and click **Connect**
6. Connection status displays with org name and avatar

### 2. Sync GitHub Members

1. On the integrations page, click **Sync Members**
2. System fetches org members and displays a preview:
   - **Matched**: GitHub members matched to existing system users
   - **Unmatched GitHub Members**: Members not found in the system
   - **Unmatched System Users**: System users with no GitHub match
   - **Conflicts**: Cross-match issues requiring review
3. Optionally select unmatched members to import as new users
4. Click **Confirm Sync** to apply enrichment

### 3. View Enriched Data

1. Navigate to **Users** and click on any enriched user
2. A **GitHub** section shows avatar, bio, public repos, and profile link
3. "Last synced" timestamp indicates data freshness

### 4. Manage Connection

- **Update Token**: Click "Update Token" on integrations page, enter new PAT
- **Disconnect**: Click "Disconnect" — removes credentials, retains enriched data
- **Re-sync**: Click "Sync Members" again anytime for fresh data

## Key Files

| Area | Files |
|------|-------|
| Schema | `src/lib/db/schema.ts` (3 new tables) |
| Migrations | `src/lib/db/migrations/` (auto-generated) |
| Validators | `src/lib/validators.ts` (new schemas) |
| GitHub API Client | `src/lib/github.ts` (REST API wrapper) |
| Connection Actions | `src/actions/github.ts` |
| Sync Actions | `src/actions/github-sync.ts` |
| Settings UI | `src/app/settings/integrations/page.tsx` |
| Settings Layout | `src/app/settings/layout.tsx` (sub-nav) |
| User Detail Update | `src/app/users/[id]/user-detail-client.tsx` (GitHub section) |
| Sidebar | `src/components/app-sidebar.tsx` (no change needed — settings nav exists) |

## Testing

```bash
# Unit tests for matching logic, GitHub API client
pnpm test

# Integration tests with real DB (sync flow)
pnpm test:integration

# E2E tests (connection flow, sync flow, user detail page)
pnpm test:e2e
```

## Environment Variables

No new environment variables required. The feature uses:
- `API_KEY_ENCRYPTION_SECRET` (existing) — encrypts the GitHub PAT
- `DATABASE_URL` (existing) — stores connection and profile data
