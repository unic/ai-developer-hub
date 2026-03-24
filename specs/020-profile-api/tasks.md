# Tasks: Profile API

**Input**: Design documents from `/specs/020-profile-api/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/profile-api.md, quickstart.md

**Tests**: Included — constitution principle I requires unit test coverage for all shared utilities and business logic.

**Organization**: Tasks are grouped by user story. US2 (auth) is foundational to US1 (data retrieval), so it appears first. Commit after each task per user preference.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Refactor existing auth and data assembly code to be reusable by the new API route. No new functionality yet — just internal restructuring.

**⚠️ CRITICAL**: The API route cannot be built until these refactors are complete.

- [x] T001 Refactor `requireCronSecret` into generic `requireBearerSecret(request, envVarName)` helper in `src/lib/auth-helpers.ts`. Keep `requireCronSecret` as a thin wrapper calling `requireBearerSecret(request, "CRON_SECRET")`. Add export for `requireBearerSecret`. Verify existing cron routes still work. → **COMMIT**: `refactor(auth): extract generic requireBearerSecret helper from requireCronSecret`
- [x] T002 Extract profile data assembly into internal pure functions in `src/actions/anthropic-usage.ts`. Create `fetchProfileDataInternal(userId: number)` and `fetchUserCostDataInternal(userId: number, month?: string)` that contain the data-fetching logic without session auth checks. Refactor existing `getProfileData` and `getUserCostData` to call these internally after their session checks. Ensure existing profile page still works. → **COMMIT**: `refactor(profile): extract internal data assembly functions for API reuse`
- [x] T003 [P] Add `api/profile` to NextAuth middleware exclusion regex in `src/middleware.ts`. Follow the existing pattern used for `api/copilot/sync` and `api/anthropic/sync`. → **COMMIT**: `feat(middleware): exclude profile API route from NextAuth middleware`

**Checkpoint**: Auth helper is generic, data assembly is reusable, middleware is configured. Ready for route implementation.

---

## Phase 2: User Story 2 - API Access Protection via Environment Secret (Priority: P1)

**Goal**: Ensure the Profile API rejects unauthenticated requests and validates Bearer tokens against `PROFILE_API_SECRET`.

**Independent Test**: Send requests with missing, incorrect, and correct Bearer tokens — verify 401 for bad tokens, 200 for correct token.

### Implementation for User Story 2

- [x] T004 [US2] Create Profile API route file `src/app/api/profile/route.ts` with GET handler that calls `requireBearerSecret(request, "PROFILE_API_SECRET")` as first operation. Return 401 for auth failures. Add `export const dynamic = "force-dynamic"`. For now, return `{ success: true, data: null }` placeholder on auth success — data retrieval is US1. → **COMMIT**: `feat(api): add profile route with bearer token authentication`
- [x] T005 [US2] Write unit tests for auth behavior in `tests/unit/api/profile-auth.test.ts`. Test cases: missing Authorization header → 401, incorrect token → 401, correct token → not 401, unset env var → 401 (fail-closed). Mock the bearer secret helper or set env vars in test setup. → **COMMIT**: `test(api): add unit tests for profile API authentication`

**Checkpoint**: Profile API route exists and rejects unauthorized requests. Auth is fully tested.

---

## Phase 3: User Story 1 - External Tool Retrieves Profile by Email (Priority: P1) 🎯 MVP

**Goal**: Return complete profile data (user info, tool assignments, cost tracking) for a given email address via the authenticated API endpoint.

**Independent Test**: Send authenticated GET request with `?email=admin@example.com` and verify response contains user fields, assignments array, and costData object.

### Implementation for User Story 1

- [x] T006 [US1] Add email query parameter validation to `src/app/api/profile/route.ts`. Parse `email` from URL search params. Validate format using Zod. Return 400 with structured error for missing or invalid email. Parse optional `month` query parameter (format: YYYY-MM). → **COMMIT**: `feat(api): add email and month query parameter validation to profile route`
- [x] T007 [US1] Implement email-to-user lookup in `src/app/api/profile/route.ts`. Query `users` table by email using Drizzle ORM (`eq(users.email, email)`). Return 404 `{ success: false, error: "Profile not found" }` if no match. Pass resolved `userId` to data assembly. → **COMMIT**: `feat(api): add email lookup and user resolution to profile route`
- [x] T008 [US1] Wire up data assembly in `src/app/api/profile/route.ts`. Call `fetchProfileDataInternal(userId)` and `fetchUserCostDataInternal(userId, month)` from T002. Assemble response per contract (`contracts/profile-api.md`): include `user` (excluding internal `id`), `assignments`, and `costData` with `month` field. Add `try/catch` returning 500 for unexpected errors. → **COMMIT**: `feat(api): implement full profile data assembly and response`
- [x] T009 [US1] Write unit tests for profile retrieval in `tests/unit/api/profile.test.ts`. Test cases: valid email → 200 with full profile shape, unknown email → 404, invalid email format → 400, missing email param → 400, valid month param → passed to cost data function, invalid month param → 400. Mock the internal data assembly functions. → **COMMIT**: `test(api): add unit tests for profile data retrieval and validation`

**Checkpoint**: Full MVP is functional. External tools can authenticate and retrieve complete profiles by email. All acceptance scenarios from spec are covered.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Verification, cleanup, and ensuring constitution compliance.

- [x] T010 Run `pnpm typecheck` and fix any TypeScript errors across modified files (`src/lib/auth-helpers.ts`, `src/actions/anthropic-usage.ts`, `src/app/api/profile/route.ts`, `src/middleware.ts`)
- [x] T011 Run `pnpm lint` and fix any ESLint warnings across modified and new files
- [x] T012 [P] Run `pnpm test` to verify all existing tests still pass (regression check for T001 and T002 refactors)
- [x] T013 Run quickstart.md manual verification: test all curl commands from `specs/020-profile-api/quickstart.md` against local dev server → **COMMIT**: `chore(020): final verification and cleanup`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — can start immediately
  - T001 and T003 can run in parallel [P] (different files)
  - T002 can run in parallel with T003 [P] (different files)
  - T001 must complete before T004 (route needs `requireBearerSecret`)
  - T002 must complete before T008 (route needs internal data functions)
- **US2 (Phase 2)**: Depends on T001 (auth helper)
- **US1 (Phase 3)**: Depends on T002 (data functions) and T004 (route file exists)
- **Polish (Phase 4)**: Depends on all implementation phases

### User Story Dependencies

- **US2 (Auth)**: Foundational — must be implemented first since US1's route handler builds on the auth-protected route created in T004
- **US1 (Data Retrieval)**: Depends on US2 (adds data retrieval to the existing auth-protected route) and T002 (internal data functions)

### Within Each Phase

```
Phase 1: T001 ──┐
         T002 ──┤──→ Phase 2
         T003 ──┘
Phase 2: T004 → T005
Phase 3: T006 → T007 → T008 → T009
Phase 4: T010 → T011 → T012 → T013
```

### Parallel Opportunities

```
# Phase 1 — these touch different files:
T001 (auth-helpers.ts) ║ T002 (anthropic-usage.ts) ║ T003 (middleware.ts)

# Phase 4 — typecheck and lint can run together:
T010 (typecheck) ║ T011 (lint)
```

---

## Implementation Strategy

### MVP First (US2 + US1)

1. Complete Phase 1: Foundational refactors (T001–T003) → 3 commits
2. Complete Phase 2: Auth-protected route stub (T004–T005) → 2 commits
3. Complete Phase 3: Full data retrieval (T006–T009) → 4 commits
4. **STOP and VALIDATE**: Test with curl commands from quickstart.md
5. Complete Phase 4: Polish (T010–T013) → 1 commit

**Total: 10 commits, 13 tasks**

### Commit Cadence

Every task produces a commit (user preference: "commit often"). Each commit is independently valid — typecheck and lint should pass at every step.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 and US2 are both P1 but US2 (auth) is foundational to US1 (data retrieval)
- Constitution requires unit tests — test tasks are included (T005, T009)
- No schema changes — no migration tasks needed
- Commit after each task per user preference
