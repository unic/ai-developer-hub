# Quickstart: Profile API Preview

**Feature**: 022-profile-api-preview
**Date**: 2026-03-26

## Prerequisites

- Node.js LTS, pnpm installed
- `PROFILE_API_SECRET` set in `.env.local`
- Database seeded with at least one user (`pnpm db:seed`)
- Dev server running (`pnpm dev`)

## Local Development

```bash
# 1. Ensure you're on the feature branch
git checkout 022-profile-api-preview

# 2. Install dependencies (if new packages were added — none expected)
pnpm install

# 3. Verify env var is set
grep PROFILE_API_SECRET .env.local

# 4. Start dev server
pnpm dev

# 5. Navigate to API Preview
# Open http://localhost:3000/settings/api-preview
# (Must be logged in as admin)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/settings/api-preview/page.tsx` | Server component: auth gate, renders client |
| `src/components/settings/api-preview-client.tsx` | Client component: form + response display |
| `src/components/ui/json-viewer.tsx` | Reusable collapsible JSON viewer |
| `src/actions/profile-api-preview.ts` | Server action: proxies request to `/api/profile` |
| `src/app/settings/settings-nav.tsx` | Modified: new "API Preview" admin tab |

## Testing the Feature

1. Log in as an admin user
2. Navigate to Settings > API Preview
3. Enter a known user email (e.g., the seeded admin email)
4. Click "Send Request"
5. Verify: formatted JSON response with status code 200 and response time
6. Try an unknown email — verify 404 error response
7. Add a month parameter (e.g., `2026-01`) — verify cost data is filtered
8. Click "Copy JSON" — paste and verify valid JSON
9. Click collapsible section headers — verify expand/collapse behavior

## Verify Checks Pass

```bash
pnpm typecheck    # TypeScript strict compilation
pnpm lint         # ESLint zero warnings
pnpm test         # Unit tests
```
