# Implementation Plan: Reliable Cron Job Authentication & Coverage

**Branch**: `018-fix-cron-auth` | **Date**: 2026-03-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/018-fix-cron-auth/spec.md`

## Summary

Cron jobs are silently failing because the Next.js auth middleware intercepts scheduled invocations and redirects them to `/login` before the route handler's secret token validation can run. The fix is a single-line change to the middleware matcher to exclude cron routes from user auth interception. Both cron routes (`/api/copilot/sync`, `/api/anthropic/sync`) already have correct handler-level token validation via `requireCronSecret()`. No schema changes or new routes are required.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), NextAuth 5.0.0-beta.30, Drizzle ORM 0.45.1
**Storage**: Neon PostgreSQL (serverless) — no schema changes
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Vercel (serverless functions + Vercel Cron Jobs)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Cron endpoints respond within 30 seconds; middleware exclusion adds zero latency overhead
**Constraints**: Must not break existing user session auth for any other routes; no new dependencies
**Scale/Scope**: 2 cron routes affected; 1 middleware file changed

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | ✅ Pass | Middleware matcher change is a string literal; no type risk |
| II. UX Consistency | ✅ N/A | No user-facing UI changes |
| III. Performance Budgets | ✅ Pass | Matcher exclusion reduces (not increases) middleware overhead |
| IV. Accessibility-First | ✅ N/A | No UI changes |
| V. Simplicity & Maintainability | ✅ Pass | Single-line fix; explicit route names over opaque wildcards |

**Gate result**: PASS — no violations. Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/018-fix-cron-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output — root cause analysis, decisions
├── data-model.md        # Phase 1 output — no schema changes
├── quickstart.md        # Phase 1 output — testing & verification guide
├── contracts/
│   └── cron-endpoints.md # Phase 1 output — API contracts for both cron routes
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (affected files only)

```text
src/
└── middleware.ts         # CHANGE: add cron routes to matcher exclusion

# No other files change
# vercel.json — no change (both cron paths already registered)
# src/lib/auth-helpers.ts — no change (requireCronSecret is correct)
# src/app/api/copilot/sync/route.ts — no change
# src/app/api/anthropic/sync/route.ts — no change
```

**Structure Decision**: Single Next.js project. Only the middleware matcher string is modified. All other existing files remain unchanged.

## Phase 0: Research Findings

See [research.md](research.md) for full details. Summary:

| Unknown | Resolution |
|---------|-----------|
| Why are cron jobs redirected to login? | Middleware matcher includes cron routes; no user session → redirect |
| How does Vercel Cron authenticate? | `Authorization: Bearer {CRON_SECRET}` header on every invocation |
| Best fix strategy? | Add cron routes to matcher negative lookahead (not conditional logic) |
| Are any cron routes missing from vercel.json? | No — both sync endpoints are already registered |
| Does `requireCronSecret` need changes? | No — implementation is correct; it's never reached due to redirect |

## Phase 1: Design

### Middleware Fix

The entire implementation is this change to `src/middleware.ts`:

```typescript
// Current (broken)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"],
};

// Fixed
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/copilot/sync|api/anthropic/sync).*)"],
};
```

**Why this works:**
- Requests to `/api/copilot/sync` and `/api/anthropic/sync` will no longer trigger the middleware
- Vercel Cron invocations pass directly to the route handler
- `requireCronSecret()` in each handler validates the `Authorization: Bearer {CRON_SECRET}` header
- Unauthorized requests (no token or wrong token) receive `401 Unauthorized` — not a redirect

### Security Posture

Excluding cron routes from user auth middleware does NOT weaken security:
- Handler-level `requireCronSecret()` remains the gate for these endpoints
- A request without a valid `CRON_SECRET` still receives 401
- No other routes are affected

### Vercel Configuration

`vercel.json` requires no changes. Both cron paths are already registered:

```json
{
  "crons": [
    { "path": "/api/copilot/sync",    "schedule": "0 6 * * *"    },
    { "path": "/api/anthropic/sync",  "schedule": "*/10 * * * *" }
  ]
}
```

### Environment Variables

`CRON_SECRET` must be set in Vercel project environment settings. No new variables needed.

## Implementation Steps

1. Edit `src/middleware.ts`: add `api/copilot/sync|api/anthropic/sync` to the matcher negative lookahead
2. Verify `CRON_SECRET` is set in Vercel environment settings (or add it if missing)
3. Deploy and confirm cron endpoints return 200 (not 302) in Vercel Cron logs

**Estimated code change**: 1 line in 1 file.
