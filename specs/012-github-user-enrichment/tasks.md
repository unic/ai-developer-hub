# Tasks: GitHub User Enrichment

**Input**: Design documents from `/specs/012-github-user-enrichment/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/server-actions.md

**Tests**: Not explicitly requested — test tasks omitted. Add manually if desired.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema additions, types, GitHub API client, and Zod validators shared across all stories

- [ ] T001 Add `githubConnectionStatusEnum`, `githubSyncStatusEnum` enums and `githubConnections`, `githubProfiles`, `githubSyncEvents` tables with relations to `src/lib/db/schema.ts` per data-model.md
- [ ] T002 Generate and apply Drizzle migration for the 3 new tables (`pnpm db:generate && pnpm db:push`)
- [ ] T003 [P] Add GitHub-related type exports (GitHubConnection, GitHubProfile, GitHubSyncEvent, GitHubMemberData, SyncPreview) to `src/types/index.ts`
- [ ] T004 [P] Add Zod validation schemas (githubTokenSchema, connectOrgSchema, confirmSyncSchema) to `src/lib/validators.ts`
- [ ] T005 [P] Create GitHub REST API client with functions: `validateTokenAndListOrgs`, `fetchOrgMembers` (paginated), `fetchUserProfile`, `checkRateLimit` — all using native fetch with `X-OAuth-Scopes` and rate limit header parsing in `src/lib/github.ts`

**Checkpoint**: Schema deployed, types exported, API client ready, validators defined

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Settings layout and shared query actions that multiple stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Create settings layout with sub-navigation tabs (Appearance | Integrations) in `src/app/settings/layout.tsx` — admin-only for Integrations tab
- [ ] T007 Implement `getActiveGitHubConnection()` query action in `src/actions/github.ts` per server-actions contract

**Checkpoint**: Foundation ready — settings sub-nav works, active connection queryable

---

## Phase 3: User Story 1 — Connect GitHub Organization (Priority: P1) MVP

**Goal**: Admin can validate a Classic PAT, select an org, and establish an encrypted connection

**Independent Test**: Provide a valid PAT → select org → verify connection persisted and visible in settings

### Implementation for User Story 1

- [ ] T008 [US1] Implement `validateGitHubToken()` server action in `src/actions/github.ts` — calls `validateTokenAndListOrgs` from github.ts client, checks `read:org` + `read:user` scopes, returns org list
- [ ] T009 [US1] Implement `connectGitHubOrg()` server action in `src/actions/github.ts` — encrypts token via `encryptApiKey`, disconnects prior active connection in transaction, inserts new row, records change history, revalidates path
- [ ] T010 [US1] Create integrations settings page (server component) in `src/app/settings/integrations/page.tsx` — fetches active connection via `getActiveGitHubConnection()`, passes to client component
- [ ] T011 [US1] Create `GitHubIntegrationClient` component in `src/app/settings/integrations/github-integration-client.tsx` with: token input form, validate button, org selector dropdown, connect button, connection status card showing org name/avatar/connected date/last sync. Use shadcn/ui Card, Input, Button, Select, Badge. Show toast on success/error via Sonner.

**Checkpoint**: Admin can connect a GitHub org. Connection visible in settings with org name and status.

---

## Phase 4: User Story 2 — Sync GitHub Members to Users (Priority: P1)

**Goal**: Admin triggers a sync, sees a preview of matched/unmatched members, confirms to enrich users and optionally import new ones

**Independent Test**: With org connected, trigger sync → verify preview shows matches → confirm → verify user profiles enriched in DB

### Implementation for User Story 2

- [ ] T012 [US2] Implement member-to-user matching logic as a pure function `matchMembersToUsers(members, users)` in `src/lib/github.ts` — username-first matching, email fallback, cross-match conflict detection, duplicate flagging per research.md Decision 5
- [ ] T013 [US2] Implement `fetchGitHubSyncPreview()` server action in `src/actions/github-sync.ts` — decrypts token, fetches paginated members, fetches individual profiles, runs matching, creates in_progress sync event, returns full preview per contract
- [ ] T014 [US2] Implement `confirmGitHubSync()` server action in `src/actions/github-sync.ts` — upserts github_profiles for matched users, populates githubUsername on email matches, creates new users for selected imports (viewer/active/temp password via bcrypt), records all changes in change history, updates sync event counts and status, updates connection lastSyncAt, revalidates paths
- [ ] T015 [US2] Implement `getSyncHistory()` query action in `src/actions/github-sync.ts` — returns recent sync events with triggeredBy user name joined
- [ ] T016 [US2] Add sync UI to `GitHubIntegrationClient` in `src/app/settings/integrations/github-integration-client.tsx` — "Sync Members" button (shown when connected), loading state with progress, sync preview display with 3 tabs (Matched/Unmatched GitHub/Unmatched System), checkboxes on unmatched members for import selection, "Confirm Sync" button, result summary toast, sync history table at bottom

**Checkpoint**: Full sync flow works end-to-end. Matched users enriched, imports created, audit trail recorded.

---

## Phase 5: User Story 3 — View Enriched GitHub Data on User Profiles (Priority: P2)

**Goal**: User detail page shows GitHub profile data (avatar, bio, repos, profile link) for enriched users

**Independent Test**: Navigate to user detail page for an enriched user → GitHub section visible with avatar, bio, repos count, and link

### Implementation for User Story 3

- [ ] T017 [US3] Implement `getGitHubProfile(userId)` query action in `src/actions/github.ts` — returns cached profile data or null per contract
- [ ] T018 [US3] Add GitHub profile section to `src/app/users/[id]/user-detail-client.tsx` — conditionally render a Card with: avatar image (Next.js Image or img with avatar_url), display name, bio, public repos count badge, external link to GitHub profile, "Last synced" relative timestamp. Show nothing if no github_profiles row exists.
- [ ] T019 [US3] Update `src/app/users/[id]/page.tsx` server component to fetch GitHub profile via `getGitHubProfile()` and pass as prop to client component

**Checkpoint**: Enriched users show GitHub data on their detail page. Users without GitHub data show no section.

---

## Phase 6: User Story 4 — Manage Organization Connection (Priority: P3)

**Goal**: Admin can disconnect an org, update the PAT, and re-sync on demand

**Independent Test**: Disconnect org → verify credentials removed but enriched data retained. Reconnect with new token → verify connection restored.

### Implementation for User Story 4

- [ ] T020 [US4] Implement `disconnectGitHubOrg()` server action in `src/actions/github.ts` — sets status to "disconnected", clears tokenEncrypted, sets disconnectedAt, records change history, revalidates path. Does NOT delete github_profiles.
- [ ] T021 [US4] Implement `updateGitHubToken()` server action in `src/actions/github.ts` — validates new token scopes and org access, encrypts and updates tokenEncrypted, records change history
- [ ] T022 [US4] Add disconnect and update-token UI to `GitHubIntegrationClient` in `src/app/settings/integrations/github-integration-client.tsx` — disconnect button with confirmation dialog (shadcn AlertDialog), "Update Token" button that reveals token input + validate + save flow. Re-sync is already available from US2's "Sync Members" button.

**Checkpoint**: Full lifecycle management works. Disconnect preserves data, token rotation works, re-sync available.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Error handling edge cases, accessibility, and final validation

- [ ] T023 [P] Add rate limit handling UI to sync flow in `src/app/settings/integrations/github-integration-client.tsx` — show remaining rate budget, warn if approaching limit, display wait time if paused
- [ ] T024 [P] Add keyboard navigation and ARIA labels to sync preview tabs, org selector, and confirmation dialogs in `src/app/settings/integrations/github-integration-client.tsx`
- [ ] T025 Run `pnpm typecheck && pnpm lint` and fix any errors across all new/modified files
- [ ] T026 Run `pnpm build` to verify production build succeeds with no errors
- [ ] T027 Run quickstart.md validation — walk through the full feature flow manually per `specs/012-github-user-enrichment/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion (schema must be deployed) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — foundation for US2 and US4
- **US2 (Phase 4)**: Depends on US1 (needs active connection to sync against)
- **US3 (Phase 5)**: Depends on Phase 2 only (reads github_profiles table; can start after foundation if test data seeded, or after US2 for real data)
- **US4 (Phase 6)**: Depends on US1 (needs active connection to disconnect/update)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Phase 2 → US1 (no other story dependency)
- **US2 (P1)**: Phase 2 → US1 → US2 (needs connection from US1)
- **US3 (P2)**: Phase 2 → US3 (independently testable with seeded data; real data requires US2)
- **US4 (P3)**: Phase 2 → US1 → US4 (needs connection from US1)

### Within Each User Story

- Server actions before UI components
- Query actions before display components
- Core logic before integration

### Parallel Opportunities

- T003, T004, T005 can all run in parallel (different files)
- T008, T009 are sequential (T009 depends on T008's validate logic)
- T012 can run in parallel with T013 prep (pure function vs action)
- T017, T018 can partially overlap (action vs component)
- T020, T021 can run in parallel (different actions, same file but different functions)
- US3 and US4 can run in parallel after US1 is complete
- T023, T024 can run in parallel (different concerns)

---

## Parallel Example: Phase 1 Setup

```bash
# These 3 tasks can run in parallel (different files):
Task T003: "Add GitHub types to src/types/index.ts"
Task T004: "Add Zod schemas to src/lib/validators.ts"
Task T005: "Create GitHub API client in src/lib/github.ts"
```

## Parallel Example: US3 + US4

```bash
# After US1 is complete, US3 and US4 can start in parallel:
# Developer A: US3 (view enriched data)
Task T017: "Implement getGitHubProfile() in src/actions/github.ts"
Task T018: "Add GitHub section to user-detail-client.tsx"
Task T019: "Update user detail page.tsx"

# Developer B: US4 (manage connection)
Task T020: "Implement disconnectGitHubOrg() in src/actions/github.ts"
Task T021: "Implement updateGitHubToken() in src/actions/github.ts"
Task T022: "Add disconnect/update UI to github-integration-client.tsx"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: Foundational (T006–T007)
3. Complete Phase 3: US1 — Connect GitHub Org (T008–T011)
4. **STOP and VALIDATE**: Admin can connect a GitHub org and see the connection status
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Connect org → Deploy/Demo (MVP!)
3. US2 → Sync members + enrich → Deploy/Demo (core value!)
4. US3 → View enriched data on profiles → Deploy/Demo
5. US4 → Manage connection lifecycle → Deploy/Demo
6. Polish → Final quality pass → Release

### Recommended Sequential Path

Phase 1 → Phase 2 → US1 → US2 → (US3 ∥ US4) → Polish

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- No new npm dependencies — native fetch for GitHub API, existing crypto for encryption
- Stop at any checkpoint to validate story independently
