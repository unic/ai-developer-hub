# Quickstart: Bulk License Import, API Key Management & User Profile Extension

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05

## Prerequisites

- Node.js LTS installed
- pnpm installed
- Neon PostgreSQL database provisioned
- `.env.local` configured with `DATABASE_URL`, `API_KEY_ENCRYPTION_SECRET`, `NEXTAUTH_SECRET`

## Setup

```bash
# Switch to feature branch
git checkout 004-bulk-license-import

# Install dependencies
pnpm install

# Push schema changes (adds user_profile enum + profile column)
pnpm db:push

# Start dev server
pnpm dev
```

## Testing the Features

### 1. Bulk License Assignment Import

1. Navigate to `/assignments` and click "Import Assignments"
2. Prepare a CSV file with these columns:

```csv
email,tool,tier,workspace,api_key,assigned_at
jane@company.com,GitHub Copilot,Business,engineering-team,sk-abc123,2026-01-15
bob@company.com,Claude,Pro,design-team,,2026-02-01
```

3. Upload the CSV — preview table shows validation status per row
4. Click "Import" — summary toast shows results

### 2. API Key on Assignment Detail

1. Navigate to `/assignments/{id}` for any assignment
2. As admin, use the "Set API Key" field to add or update an API key
3. Use "Clear" to remove an existing API key
4. Verify reveal/copy functionality works with the updated key

### 3. User Profile Field

1. Navigate to `/users/new` — "Profile" dropdown is available (Boost/Maxed/Indie)
2. Edit existing user at `/users/{id}` — Profile field in edit form
3. Users list at `/users` — Profile column shows values
4. Bulk user import at `/users/import` — add `profile` column to CSV

## Sample CSV for Bulk User Import (with profile)

```csv
name,email,circle,role,github_username,profile
Alice Smith,alice@company.com,Engineering,viewer,alicesmith,boost
Bob Jones,bob@company.com,Design,viewer,bobjones,maxed
```

## Verification Commands

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# E2E tests
pnpm test:e2e
```
