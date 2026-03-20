# Tasks: Reliable Cron Job Authentication & Coverage

**Input**: Design documents from `/specs/018-fix-cron-auth/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Not requested — no test tasks generated.

**Organization**: Tasks grouped by user story. This is a minimal-scope fix (1 line of code change) with verification tasks per story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- No test tasks — spec did not request TDD

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm environment is ready before making changes

- [x] T001 Verify `CRON_SECRET` is set in `.env.local` for local testing (generate with `openssl rand -base64 32` if missing; document value matches Vercel env)
- [x] T002 [P] Read `src/middleware.ts` to confirm exact current matcher string before editing

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single code change that unblocks ALL user stories — must complete before any story can be verified

**⚠️ CRITICAL**: All user story verification depends on this fix being deployed

- [x] T003 Edit `src/middleware.ts`: add `api/copilot/sync|api/anthropic/sync` to the matcher negative lookahead so the updated matcher reads `/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/copilot/sync|api/anthropic/sync).*)`

**Checkpoint**: Middleware fix applied — user story verification can now begin

---

## Phase 3: User Story 1 - Cron Jobs Bypass Auth Redirect (Priority: P1) 🎯 MVP

**Goal**: Cron endpoints pass through the middleware and respond to requests based on the `CRON_SECRET` token alone — no user session required.

**Independent Test**: Trigger `GET /api/copilot/sync` without a token → 401 (not a 302 redirect). Trigger with valid token → 200 with sync results.

### Implementation for User Story 1

- [x] T004 [US1] Run `pnpm typecheck` to confirm the middleware edit introduced no TypeScript errors
- [x] T005 [US1] Run `pnpm lint` to confirm zero ESLint warnings after the middleware change
- [x] T006 [P] [US1] Start dev server (`pnpm dev`) and verify `GET http://localhost:3000/api/copilot/sync` without `Authorization` header returns `401 {"success":false,"error":"Unauthorized"}` (not a 302 redirect to `/login`)
- [x] T007 [P] [US1] Verify `GET http://localhost:3000/api/anthropic/sync` without `Authorization` header returns `401 {"success":false,"error":"Unauthorized"}` (not a 302 redirect)
- [x] T008 [US1] Verify `GET http://localhost:3000/api/copilot/sync` with `Authorization: Bearer {CRON_SECRET}` returns `200` with a JSON body (sync result or 404 if no connection configured — either is correct; the point is no redirect)
- [x] T009 [US1] Verify `GET http://localhost:3000/api/anthropic/sync` with `Authorization: Bearer {CRON_SECRET}` returns `200` or `500` with a JSON body — NOT a redirect

**Checkpoint**: User Story 1 is fully functional. Cron endpoints no longer redirect. MVP is complete at this point.

---

## Phase 4: User Story 2 - GitHub Copilot Sync Runs on Schedule (Priority: P2)

**Goal**: The daily Copilot billing sync runs end-to-end without a user session and returns billing metrics.

**Independent Test**: Trigger `GET /api/copilot/sync` with valid secret and a configured GitHub connection → 200 with `billingLinked` and `billingSkipped` counts.

### Implementation for User Story 2

- [x] T010 [US2] Confirm `vercel.json` cron entry for `/api/copilot/sync` has schedule `0 6 * * *` (daily at 06:00 UTC) — no change needed if already correct
- [ ] T011 [US2] Confirm `CRON_SECRET` environment variable is set in the Vercel project dashboard (Settings → Environment Variables) — required for Vercel to inject the auth header on scheduled invocations
- [ ] T012 [US2] Trigger `GET /api/copilot/sync` with `Authorization: Bearer {CRON_SECRET}` in the deployed environment and confirm response is `200` with `{"success":true,"syncEventId":...}` — verifies the full production path works

**Checkpoint**: Copilot daily sync is confirmed working end-to-end in production.

---

## Phase 5: User Story 3 - Anthropic API Usage Sync Runs on Schedule (Priority: P2)

**Goal**: The every-10-minute Anthropic usage sync runs end-to-end without a user session and returns a sync summary.

**Independent Test**: Trigger `GET /api/anthropic/sync` with valid secret → 200 with sync summary (records count, date range).

### Implementation for User Story 3

- [x] T013 [US3] Confirm `vercel.json` cron entry for `/api/anthropic/sync` has schedule `*/10 * * * *` (every 10 minutes) — no change needed if already correct
- [ ] T014 [US3] Trigger `GET /api/anthropic/sync` with `Authorization: Bearer {CRON_SECRET}` in the deployed environment and confirm response is `200` with `{"success":true,...}` — verifies the full production path works

**Checkpoint**: Anthropic sync is confirmed working end-to-end in production.

---

## Phase 6: User Story 4 - Missing Cron Jobs Are Added (Priority: P3)

**Goal**: Every sync endpoint that exists in the codebase appears in the scheduled job configuration. No silent gaps.

**Independent Test**: Enumerate all `route.ts` files under `src/app/api/` and confirm every sync route (`requireCronSecret`) is listed in `vercel.json` crons.

### Implementation for User Story 4

- [x] T015 [US4] Audit `src/app/api/` directory: list every route file that calls `requireCronSecret` and cross-reference with `vercel.json` cron paths to identify any gaps
- [x] T016 [US4] If T015 finds unregistered sync routes: add the missing `{ "path": "...", "schedule": "..." }` entries to `vercel.json`; if no gaps found, document the audit result as a comment in `vercel.json` or this tasks file

**Checkpoint**: Cron configuration is complete and audited. All sync endpoints are scheduled.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all stories before merge

- [x] T017 [P] Run `pnpm build` to confirm production build succeeds with no errors after all changes
- [ ] T018 [P] Check Vercel Cron Jobs dashboard after next scheduled run to confirm both cron jobs show `200` status (not `302`) in execution history
- [x] T019 Verify that protected user-facing routes (e.g., `/dashboard`) still require login — confirm the middleware fix did NOT accidentally open other routes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately; T001 and T002 run in parallel
- **Foundational (Phase 2)**: Depends on Phase 1 — T003 is the single blocking change
- **User Stories (Phases 3–6)**: All depend on T003 (middleware fix) being complete
  - US1 verification (Phase 3) can begin immediately after T003
  - US2 and US3 (Phases 4–5) require a deployed environment; can run in parallel after Phase 3
  - US4 audit (Phase 6) is independent and can run in parallel with Phases 4–5
- **Polish (Phase 7)**: Depends on all user story phases being complete

### User Story Dependencies

- **US1 (P1)**: Depends only on T003 — no other story dependencies
- **US2 (P2)**: Depends on US1 passing; requires Vercel deployment
- **US3 (P2)**: Depends on US1 passing; requires Vercel deployment; parallel with US2
- **US4 (P3)**: Independent of US1-3; can be done any time after T003

### Parallel Opportunities

- T001 and T002 (Phase 1) run in parallel
- T006 and T007 (Phase 3 dev verification) run in parallel after dev server starts
- T010–T012 (US2) and T013–T014 (US3) run in parallel after Phase 3
- T015–T016 (US4) runs in parallel with Phases 4–5
- T017 and T018 (Polish) run in parallel

---

## Parallel Example: User Story 1

```bash
# After T003 (middleware fix) and dev server started:
# Run both verification checks simultaneously:
Task: "Verify /api/copilot/sync without token returns 401" (T006)
Task: "Verify /api/anthropic/sync without token returns 401" (T007)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (verify env)
2. Complete Phase 2: Apply middleware fix (T003 — 1 line)
3. Complete Phase 3: Verify US1 with curl/dev server
4. **STOP and VALIDATE**: Both cron endpoints return 401 (no token) / 200 (valid token) — no redirects
5. Deploy — this alone fixes the production failure

### Incremental Delivery

1. Phase 1 + 2 → Middleware fixed
2. Phase 3 → US1 verified locally (MVP!)
3. Phase 4 + 5 (parallel) → Production cron execution confirmed
4. Phase 6 → Coverage audit complete
5. Phase 7 → Final polish and build gate

### Parallel Team Strategy

With two developers after Phase 2:
- Developer A: Phase 3 (US1 local verification) → Phase 4 (US2 production)
- Developer B: Phase 6 (US4 audit) → Phase 5 (US3 production)

---

## Notes

- [P] tasks = different files or independent actions with no blocking dependencies
- [Story] label maps each task to its user story for traceability
- The entire code change is T003 (1 line in `src/middleware.ts`)
- All remaining tasks are verification, configuration, and validation
- No schema changes, no new routes, no new dependencies
- Commit after T003; all remaining tasks are verification only until T016 (if gaps found in audit)
