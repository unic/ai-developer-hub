# Quickstart: Cron Job Auth Fix

**Feature**: 018-fix-cron-auth
**Date**: 2026-03-20

## The Problem

Vercel Cron Jobs fire as unauthenticated HTTP requests. The Next.js auth middleware sees no user session and redirects to `/login` before the cron route handler can validate the `CRON_SECRET` token.

## The Fix (1 line)

Edit `src/middleware.ts` — add `api/copilot/sync` and `api/anthropic/sync` to the negative lookahead in the matcher:

```typescript
// Before
matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"]

// After
matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/copilot/sync|api/anthropic/sync).*)"]
```

## Environment Setup

Ensure `CRON_SECRET` is set in:
1. **Vercel project environment variables** (required for production cron invocations)
2. **`.env.local`** (for local testing)

Generate a value:
```bash
openssl rand -base64 32
```

## Testing Locally

After applying the middleware fix, verify a cron endpoint works:

```bash
# Should return 200 with sync results (not a 302 redirect)
curl -X GET http://localhost:3000/api/copilot/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Should return 401 (not a 302 redirect)
curl -X GET http://localhost:3000/api/copilot/sync

# Should return 401 (not a 302 redirect)
curl -X GET http://localhost:3000/api/anthropic/sync
```

## Verifying in Production

After deployment:
1. Check Vercel dashboard → Cron Jobs tab for execution history
2. Look for 200 status codes (previously would show 302 redirects)
3. Check runtime logs for sync summaries

## Files Changed

| File | Change |
|------|--------|
| `src/middleware.ts` | Add cron routes to matcher exclusion |

No other files require modification.
