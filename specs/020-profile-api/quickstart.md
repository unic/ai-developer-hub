# Quickstart: Profile API

**Feature**: 020-profile-api
**Date**: 2026-03-23

## Prerequisites

- Node.js LTS + pnpm installed
- Neon PostgreSQL database with existing schema (users, license_assignments, anthropic_usage_metrics)
- `.env.local` file with existing database credentials

## Setup

1. Add the new environment variable to `.env.local`:

   ```
   PROFILE_API_SECRET=<generate-a-secure-random-string>
   ```

   Generate a secure value:
   ```bash
   openssl rand -hex 32
   ```

2. Start the dev server:

   ```bash
   pnpm dev
   ```

3. Test the endpoint:

   ```bash
   curl -H "Authorization: Bearer <your-secret>" \
     "http://localhost:3000/api/profile?email=admin@example.com"
   ```

## Files Changed

| File | Change |
|------|--------|
| `src/lib/auth-helpers.ts` | Add generic `requireBearerSecret` helper; refactor `requireCronSecret` to use it |
| `src/actions/anthropic-usage.ts` | Extract `fetchProfileData` and `fetchUserCostData` as internal pure functions |
| `src/app/api/profile/route.ts` | **NEW** — Profile API route handler |
| `src/middleware.ts` | Add `api/profile` to NextAuth exclusion regex |
| `tests/unit/api/profile.test.ts` | **NEW** — Unit tests |

## Verification

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# Manual test — success
curl -s -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "http://localhost:3000/api/profile?email=admin@example.com" | jq .

# Manual test — unauthorized
curl -s "http://localhost:3000/api/profile?email=admin@example.com" | jq .
# Expected: {"success":false,"error":"Unauthorized"}

# Manual test — not found
curl -s -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "http://localhost:3000/api/profile?email=nonexistent@example.com" | jq .
# Expected: {"success":false,"error":"Profile not found"}

# Manual test — specific month
curl -s -H "Authorization: Bearer $PROFILE_API_SECRET" \
  "http://localhost:3000/api/profile?email=admin@example.com&month=2026-02" | jq .
```

## Production Deployment

Add `PROFILE_API_SECRET` to your Vercel environment variables (or equivalent hosting provider). The value should be a cryptographically random string, different from `CRON_SECRET`.
