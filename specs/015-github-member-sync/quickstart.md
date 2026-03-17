# Quickstart: 015-github-member-sync

**Date**: 2026-03-10

## Prerequisites

- Node.js LTS, pnpm installed
- Neon PostgreSQL database configured (`.env.local` with `DATABASE_URL`)
- GitHub org connected via Settings > Integrations (existing feature)

## Setup

```bash
# Install new dependency
pnpm add string-similarity
pnpm add -D @types/string-similarity

# Generate and apply migration for new columns
pnpm db:generate
pnpm db:migrate

# Start dev server
pnpm dev
```

## What Changed

### Schema
- `githubSyncEvents` table: added `manuallyMatchedCount` and `createdCount` integer columns

### New Dependency
- `string-similarity` — Dice coefficient scoring for name matching suggestions

### Files Modified
- `src/lib/db/schema.ts` — two new columns on githubSyncEvents
- `src/actions/github-sync.ts` — extended confirmGitHubSync, new searchUsersForMatching
- `src/lib/validators.ts` — new Zod schemas for manual match and inline creation
- `src/app/settings/integrations/github-integration-client.tsx` — major UI changes for manual matching flow

### Files Created
- `src/lib/match-suggestions.ts` — client-side similarity scoring utility
- `src/components/user-search-combobox.tsx` — reusable searchable user picker (Command + Popover)
- `src/components/inline-user-form.tsx` — compact inline user creation form
- `src/components/unmatched-member-card.tsx` — card component for each unmatched member with resolution actions
- Migration file in `src/lib/db/migrations/`

## Testing

```bash
# Type check
pnpm typecheck

# Unit tests (match suggestion scoring, validation schemas)
pnpm test

# E2E (sync flow with manual matching)
pnpm test:e2e
```

## Verification Flow

1. Navigate to Settings > Integrations
2. Click "Sync Members" with a connected GitHub org
3. In the sync preview, go to the "Unmatched" tab
4. For each unmatched member, verify:
   - Suggested matches appear (up to 3)
   - "Match to existing user" opens a searchable combobox
   - "Create new user" shows an inline form pre-filled with GitHub data
   - "Skip" marks the member as skipped
5. Verify resolution progress counter updates in real-time
6. Click "Confirm Sync" and verify the confirmation dialog if unresolved members remain
7. After confirmation, verify:
   - Matched users have `githubUsername` set
   - Created users appear in the users list
   - Sync history shows manuallyMatched and created counts
8. Run sync again — previously matched members should auto-match
