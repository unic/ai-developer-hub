# Research: Reliable Cron Job Authentication & Coverage

**Feature**: 018-fix-cron-auth
**Date**: 2026-03-20
**Status**: Complete — all unknowns resolved

---

## Decision 1: Root Cause of Auth Redirect

**Decision**: The Next.js middleware matcher does not exclude cron routes, so every request to `/api/copilot/sync` and `/api/anthropic/sync` runs through the auth middleware, which redirects unauthenticated requests (including Vercel Cron invocations) to `/login` before the route handler's `requireCronSecret()` check ever executes.

**Evidence — current middleware matcher:**
```typescript
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"],
};
```
Only `/api/auth/**` is excluded. Cron routes are not excluded.

**Evidence — redirect logic in middleware:**
```typescript
if (!req.auth && !isPublicPath(pathname)) {
  const callbackUrl = encodeURIComponent(pathname + search);
  return NextResponse.redirect(
    new URL(`/login?callbackUrl=${callbackUrl}`, req.url)
  );
}
```
Vercel Cron invocations carry no user session, so `req.auth` is `null` → redirect fires.

**Alternatives considered:**
- Conditional logic inside middleware to check for CRON_SECRET: rejected — middleware still executes, adds complexity, mixes concerns (cron auth belongs in the handler)
- Moving `requireCronSecret` into middleware: rejected — tightly couples machine-to-machine auth to the user auth middleware

**Rationale**: Exclude cron routes from the middleware matcher. This is the standard Next.js approach for machine-to-machine API routes: they bypass the user session middleware entirely and rely on their own handler-level token validation (`requireCronSecret`).

---

## Decision 2: Middleware Fix Strategy

**Decision**: Update the middleware matcher's negative lookahead to exclude `/api/copilot/sync` and `/api/anthropic/sync`.

**Exact change:**
```typescript
// Before
matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"]

// After
matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/copilot/sync|api/anthropic/sync).*)"]
```

**Why explicit paths over a wildcard pattern (e.g., `api/.*/sync`):**
- Wildcard patterns are ambiguous and could accidentally exclude future admin routes
- Explicit paths are self-documenting and reviewable
- No performance cost difference for static strings in regex negative lookahead

**Alternatives considered:**
- `api/.*sync` wildcard: rejected — too broad, catches unintended routes
- `api/cron/` namespace (restructuring routes): rejected — unnecessary breaking change

---

## Decision 3: Vercel Cron Authentication Protocol

**Decision**: Confirmed — Vercel Cron Jobs automatically inject `Authorization: Bearer {CRON_SECRET}` on every scheduled invocation when `CRON_SECRET` is set in the Vercel project environment.

**Existing `requireCronSecret` implementation is correct:**
```typescript
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
```

No changes needed to route handlers or the auth helper — both cron routes already call `requireCronSecret` on GET and POST.

---

## Decision 4: Missing Cron Jobs Audit

**Decision**: No new cron routes need to be created. The two sync endpoints that exist (`/api/copilot/sync`, `/api/anthropic/sync`) are both already registered in `vercel.json`. No other sync endpoints exist in the codebase.

**Full API route inventory:**
```
src/app/api/
├── anthropic/sync/route.ts     ← cron route ✅ in vercel.json
├── auth/[...nextauth]/route.ts ← auth handler (excluded from middleware)
├── copilot/sync/route.ts       ← cron route ✅ in vercel.json
├── export/assignments/route.ts ← admin route (requireAdmin)
├── export/users/route.ts       ← admin route (requireAdmin)
└── invoices/
    ├── [id]/pdf/route.ts       ← admin route (requireAdmin)
    ├── bulk-upload/route.ts    ← admin route (requireAdmin)
    └── upload-url/route.ts     ← admin route (requireAdmin)
```

**GitHub billing/member sync**: Triggered manually via Server Actions and UI buttons — not cron-automated. No missing registration issue.

**What User Story 4 means in practice**: Adding the cron routes to the middleware exclusion list is itself the "fix" that makes them reliably registered. No new route files are needed.

---

## Decision 5: CRON_SECRET Environment Variable

**Decision**: `CRON_SECRET` must be set in Vercel project environment settings (not just `.env.local`) for cron invocations to be authenticated. Local development testing can use `.env.local`.

**Generation command** (already documented in `.env.local.example`):
```bash
openssl rand -base64 32
```

**No code change needed** — the env var reference is already correct in `auth-helpers.ts`.

---

## Summary: Scope of Changes Required

| Change | File | Type |
|--------|------|------|
| Add cron routes to middleware matcher exclusion | `src/middleware.ts` | 1-line fix |
| Verify `CRON_SECRET` is set in Vercel env | Vercel dashboard | Config |
| No new routes needed | — | None |
| No schema changes needed | — | None |
| No handler changes needed | — | None |

**Total implementation scope**: 1 line of code change + environment variable verification. The root cause is purely a middleware configuration gap.
