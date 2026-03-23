# Implementation Plan: Profile API

**Branch**: `020-profile-api` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-profile-api/spec.md`

## Summary

Expose existing user profile data (user info, tool assignments, cost tracking) as a read-only API endpoint authenticated via a dedicated `PROFILE_API_SECRET` environment variable. External tools look up profiles by email address. The implementation reuses the existing `getProfileData` and `getUserCostData` logic from `src/actions/anthropic-usage.ts`, wrapped in a new API route following the established cron-secret Bearer token pattern.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` — no schema changes
**Testing**: Vitest (unit/integration)
**Target Platform**: Vercel (Node.js serverless)
**Project Type**: Web service (Next.js API route)
**Performance Goals**: < 2 seconds response time, 100+ req/min throughput
**Constraints**: Read-only, no new database tables, reuse existing data assembly logic
**Scale/Scope**: Single API endpoint, ~3 source files modified/created

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | ✅ Pass | All new code in TypeScript strict mode. API response type exported. Unit tests required. |
| II. UX Consistency | ✅ N/A | No user-facing UI in this feature (API-only). |
| III. Performance Budgets | ✅ Pass | API route, not a page — no Core Web Vitals applicable. Response time target: < 2s. |
| IV. Accessibility-First | ✅ N/A | No user-facing UI in this feature. |
| V. Simplicity & Maintainability | ✅ Pass | Reuses existing data assembly functions. Single new route file. Generic Bearer token helper avoids duplication without over-abstracting. |

No gate violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/020-profile-api/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── profile-api.md   # API contract
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── api/
│       └── profile/
│           └── route.ts          # NEW — Profile API route handler
├── lib/
│   └── auth-helpers.ts           # MODIFIED — add requireBearerSecret generic helper
└── middleware.ts                  # MODIFIED — exclude api/profile from NextAuth

tests/
└── unit/
    └── api/
        └── profile.test.ts       # NEW — unit tests for Profile API
```

**Structure Decision**: Follows existing Next.js App Router API route convention (`src/app/api/<name>/route.ts`). The auth helper is extended rather than duplicated. No new directories beyond `src/app/api/profile/` and `tests/unit/api/`.

## Implementation Approach

### Key Design Decisions

1. **Generic Bearer token helper**: Refactor `requireCronSecret` into a `requireBearerSecret(request, envVarName)` helper, then have `requireCronSecret` call it with `"CRON_SECRET"`. New route calls it with `"PROFILE_API_SECRET"`. This avoids code duplication while keeping the change minimal. Existing callers remain unchanged.

2. **Bypass session auth in data assembly**: The existing `getProfileData` and `getUserCostData` functions check `auth()` session internally. The API route has no session (Bearer token auth). Two options:
   - **Option A**: Create new "internal" variants that skip session checks — adds duplication.
   - **Option B (chosen)**: Extract the data-fetching logic into pure functions that accept a userId and return data, then have both the server actions and the API route call these. The server actions retain their session checks as wrappers.

   This is the cleanest separation: auth logic stays in the action wrappers, data assembly is reusable.

3. **Email-to-userId resolution**: The API accepts an email, but existing functions work with userId. The route handler queries `users` by email first, then passes the userId to the data assembly functions.

4. **Response format**: Follows the established `{ success: true/false, ... }` pattern used by all existing API routes.

5. **Month parameter**: Passed as a query parameter `?month=2026-02`. Validated by existing logic in `getUserCostData`.

### Commit Strategy

Per user preference: commit after each logical unit of work. Planned commits:

1. Refactor `requireCronSecret` → generic `requireBearerSecret` helper
2. Extract profile data assembly into reusable internal functions
3. Add Profile API route handler
4. Add middleware exclusion for `api/profile`
5. Add unit tests
6. Add integration tests (if applicable)
