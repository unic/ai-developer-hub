# Research: Profile API

**Feature**: 020-profile-api
**Date**: 2026-03-23

## R1: Auth Pattern for API Routes

**Decision**: Use Bearer token pattern with a dedicated `PROFILE_API_SECRET` environment variable, following the existing `requireCronSecret` pattern.

**Rationale**: The codebase already has a proven pattern in `src/lib/auth-helpers.ts` — `requireCronSecret()` validates `Authorization: Bearer <token>` against `process.env.CRON_SECRET`. Creating a parallel helper for `PROFILE_API_SECRET` is minimal effort and maintains consistency. Using a dedicated env var (not reusing `CRON_SECRET`) follows principle of least privilege — keys can be rotated independently.

**Alternatives considered**:
- Reuse `CRON_SECRET`: Simpler (one less secret) but couples API access to cron access — rejected for security reasons.
- NextAuth session-based auth: Requires the external tool to maintain a browser session — not viable for machine-to-machine calls.
- OAuth2 / JWT: Over-engineered for a single internal API with one shared secret — rejected per constitution principle V (simplicity).

## R2: Reusing Profile Data Assembly Logic

**Decision**: Extract data-fetching logic from `getProfileData` and `getUserCostData` (in `src/actions/anthropic-usage.ts`) into pure internal functions that accept a userId. Server actions become thin wrappers that add session auth checks.

**Rationale**: The existing functions couple two concerns: (1) session-based authorization and (2) data assembly. The API route authenticates via Bearer token, not sessions — so it cannot call functions that call `auth()`. Extracting the data assembly into pure functions (`fetchProfileData(userId)`, `fetchUserCostData(userId, month?)`) allows both the server actions and the API route to share the same data logic without duplication.

**Alternatives considered**:
- Duplicate the data-fetching code in the API route: Violates DRY — rejected.
- Mock/bypass the session in the API route: Fragile and couples the API to NextAuth internals — rejected.
- Call the server actions directly and suppress auth: Not possible without hacking NextAuth — rejected.

## R3: Middleware Configuration

**Decision**: Add `api/profile` to the NextAuth middleware exclusion regex in `src/middleware.ts`.

**Rationale**: Existing cron routes (`api/copilot/sync`, `api/anthropic/sync`) are excluded the same way. The Profile API handles its own auth via Bearer token, so NextAuth middleware must not intercept it.

**Alternatives considered**:
- Route-level middleware: Next.js doesn't support per-route middleware well — rejected.
- Separate middleware file: Unnecessary complexity — rejected.

## R4: Response Shape

**Decision**: Use the established `{ success: true/false, ... }` response format. Profile data nested under a `data` key for success responses.

**Rationale**: All existing API routes use this format (see `src/app/api/anthropic/sync/route.ts`, copilot sync). Consistency reduces integration friction for consumers and aligns with the `ActionResult` type pattern.

**Alternatives considered**:
- Direct data response (no wrapper): Inconsistent with existing patterns — rejected.
- GraphQL: Over-engineered for a single endpoint — rejected.

## R5: Email Lookup Strategy

**Decision**: Query the `users` table by email (which has a unique index `users_email_idx`) to resolve the userId, then pass it to the extracted data assembly functions.

**Rationale**: The `users` table already has a unique index on email (`uniqueIndex("users_email_idx")`), so lookup is efficient. The existing data assembly functions work with userId, so a two-step approach (resolve email → fetch data) is the simplest integration path.

**Alternatives considered**:
- Rewrite data assembly to accept email: Larger refactor, touches more code — rejected.
- Cache email-to-userId mapping: Premature optimization — rejected per constitution principle V.
