# Tasks: GitHub Member Sync — Manual Matching

**Input**: Design documents from `/specs/015-github-member-sync/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/server-actions.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependency and apply schema migration

- [x] T001 Install `string-similarity` and `@types/string-similarity` via pnpm in package.json
- [x] T002 Add `manuallyMatchedCount` (integer, nullable) and `createdCount` (integer, nullable) columns to `githubSyncEvents` table in src/lib/db/schema.ts
- [x] T003 Generate Drizzle migration for the new columns via `pnpm db:generate` and verify the migration SQL

**Checkpoint**: Schema updated, new dependency available. Commit after this phase.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, validators, and utilities that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Add `PendingResolution` (discriminated union: match | create | skip), `MatchSuggestion`, and `ResolutionSummary` types to src/types/index.ts per data-model.md client-side types section
- [x] T005 [P] Add Zod schemas to src/lib/validators.ts: `manualMatchSchema` (githubLogin + userId), `inlineUserCreationSchema` (githubLogin + name + email), and `confirmGitHubSyncSchema` (extend existing to include manualMatches and newUsers arrays)
- [x] T006 [P] Create src/lib/match-suggestions.ts: implement `computeMatchSuggestions(unmatchedMember: SyncUnmatchedMember, systemUsers: SyncUnmatchedSystemUser[]): MatchSuggestion[]` using `string-similarity` compareTwoStrings for name scoring and domain extraction for email scoring; return top 3 sorted by score descending; include both active and inactive users with inactive sorted lower at equal scores
- [x] T007 Create `searchUsersForMatching` server action in src/actions/github-sync.ts: accepts `{ query: string; excludeUserIds?: number[] }`, searches users by name/email (case-insensitive ilike), includes active and inactive users, sorts active first then alphabetical, limits to 20 results, requires admin session per contracts/server-actions.md

**Checkpoint**: Foundation ready — types, validation, suggestions, and search API all available. Commit after this phase.

---

## Phase 3: User Story 1 — Review Unmatched GitHub Members (Priority: P1) 🎯 MVP

**Goal**: Display unmatched GitHub members as resolution cards with top 3 match suggestions, replacing the current checkbox-based unmatched table.

**Independent Test**: Trigger a sync preview with known unmatched members → verify card-based unmatched section renders with avatars, usernames, profile links, and suggested matches.

### Implementation for User Story 1

- [ ] T008 [P] [US1] Create src/components/unmatched-member-card.tsx: a card component that displays a single unmatched GitHub member (avatar via `githubAvatarUrl`, login as heading, `githubName` as subtitle, link to `githubProfileUrl`, `githubEmail` if available) with a suggestions section showing up to 3 `MatchSuggestion` items (user name, email, status badge for inactive, score-based match reason), and action buttons placeholder area for resolution actions (match/create/skip — wired in later stories)
- [ ] T009 [US1] Refactor the "Unmatched" tab in src/app/settings/integrations/github-integration-client.tsx: replace the existing `UnmatchedTable` (checkbox-based import list) with a scrollable list of `UnmatchedMemberCard` components; add `pendingResolutions` state as `Map<string, PendingResolution>` (keyed by githubLogin); compute suggestions for each unmatched member by calling `computeMatchSuggestions()` with the `unmatchedSystemUsers` from the sync preview; hide/show "all matched" success message when unmatched list is empty
- [ ] T010 [US1] Add visual state indicators to unmatched-member-card.tsx: when a pending resolution exists for a member, show the resolution type as a badge (e.g., "Matched to [name]", "New user: [name]", "Skipped") and dim the card; when no resolution exists, show full card with action buttons

**Checkpoint**: US1 complete — unmatched members display as cards with suggestions. Commit after this phase.

---

## Phase 4: User Story 2 — Manually Match to Existing User (Priority: P1)

**Goal**: Enable admins to search for and select an existing application user to match with an unmatched GitHub member, with overwrite warnings.

**Independent Test**: Click "Match to user" on an unmatched member → search for a user → select → verify the member moves to matched state in the preview with the correct pending resolution.

### Implementation for User Story 2

- [ ] T011 [P] [US2] Create src/components/user-search-combobox.tsx: a `Command` + `Popover` component using shadcn/ui; accepts `onSelect(user)` callback and `excludeUserIds` prop; calls `searchUsersForMatching` server action on input change (debounced 300ms); displays results with user name, email, status badge (inactive users visually distinguished), and existing githubUsername if set; supports keyboard navigation via cmdk; shows "No users found" empty state
- [ ] T012 [US2] Add "Match to existing user" action flow in src/components/unmatched-member-card.tsx: clicking the "Match" button opens `UserSearchCombobox` inline; when a user is selected, if the selected user already has a different `githubUsername`, show an `AlertDialog` warning "This user is already linked to GitHub user [existing]. Replace with [new]?" requiring confirmation (FR-009); on confirmation (or if no conflict), call a parent callback `onResolve({ type: "match", githubLogin, userId, userName })` to update the `pendingResolutions` map
- [ ] T013 [US2] Extend `confirmGitHubSync` in src/actions/github-sync.ts to process `manualMatches` array: for each `{ githubLogin, userId }`, validate user exists in DB, update `users.githubUsername` to githubLogin, upsert `githubProfiles` row with enriched GitHub data from the re-fetched member list, record `changeHistory` entry with entityType "user", changeType "updated", fieldName "githubUsername", previousValue (old username or null), newValue (new githubLogin); return `manuallyMatched` count in result

**Checkpoint**: US2 complete — manual matching flow works end-to-end including server-side persistence. Commit after this phase.

---

## Phase 5: User Story 3 — Create New User Inline (Priority: P1)

**Goal**: Enable admins to create a new system user directly from an unmatched GitHub member's card, with pre-filled name and email from GitHub.

**Independent Test**: Click "Create new user" on an unmatched member → verify form is pre-filled with GitHub name and email → submit → verify member moves to "create" resolution state.

### Implementation for User Story 3

- [ ] T014 [P] [US3] Create src/components/inline-user-form.tsx: a collapsible compact form pre-filled with `name` (from `githubName || githubLogin`), `email` (from `githubEmail` or empty — required field), `githubUsername` (from `githubLogin`, read-only display), `role` (default "viewer", hidden); validate with `inlineUserCreationSchema` from validators.ts; on submit call parent callback `onResolve({ type: "create", githubLogin, name, email })`; show validation errors inline (e.g., email required if not pre-filled)
- [ ] T015 [US3] Add "Create new user" action flow in src/components/unmatched-member-card.tsx: clicking "Create" button expands the `InlineUserForm` below the card; pass GitHub member data as initial values; on form submission, update `pendingResolutions` map with type "create" and collapse the form
- [ ] T016 [US3] Extend `confirmGitHubSync` in src/actions/github-sync.ts to process `newUsers` array: for each `{ githubLogin, name, email }`, validate email uniqueness, create user with name, email, githubUsername = githubLogin, role = "viewer", passwordHash = hashed "changeme123" (reuse existing temp password pattern), status = "active"; upsert `githubProfiles` row; record `changeHistory` entry with entityType "user", changeType "created", newValue as JSON of { name, email, githubUsername }; return `created` count in result

**Checkpoint**: US3 complete — inline user creation works with pre-filled GitHub data. Commit after this phase.

---

## Phase 6: User Story 4 — Bulk Resolution & Confirm Flow (Priority: P2)

**Goal**: Enable efficient batch resolution with progress tracking, skip/undo actions, and a confirmation dialog for unresolved members.

**Independent Test**: Present 10+ unmatched members → resolve several (mix of match, create, skip) → verify progress counter → click Confirm → verify dialog shows unresolved count → confirm → verify all resolutions processed.

### Implementation for User Story 4

- [ ] T017 [P] [US4] Add resolution progress summary bar to src/app/settings/integrations/github-integration-client.tsx: compute `ResolutionSummary` from `pendingResolutions` map; display as a horizontal bar or stat row showing "X of Y resolved" with breakdown (matched: N, created: N, skipped: N, unresolved: N); update reactively as resolutions change (FR-007)
- [ ] T018 [P] [US4] Add "Skip" action to src/components/unmatched-member-card.tsx: clicking "Skip" calls `onResolve({ type: "skip", githubLogin })`; card shows "Skipped" badge; skipped members remain visible but dimmed
- [ ] T019 [US4] Add undo functionality in src/components/unmatched-member-card.tsx: when a pending resolution exists (any type), show an "Undo" button that calls parent callback `onUndo(githubLogin)` to remove the entry from `pendingResolutions` map; card returns to full unresolved state with action buttons (FR-008)
- [ ] T020 [US4] Add confirmation dialog for unresolved members in src/app/settings/integrations/github-integration-client.tsx: when "Confirm Sync" is clicked and `resolutionSummary.unresolved > 0`, show an `AlertDialog` stating "N members remain unresolved. They will stay unmatched. Continue?" with Cancel/Continue buttons (FR-008a); if all resolved, proceed directly without dialog
- [ ] T021 [US4] Wire "Confirm Sync" button in src/app/settings/integrations/github-integration-client.tsx to extract `manualMatches` and `newUsers` arrays from `pendingResolutions` map and pass them to `confirmGitHubSync` along with existing `importGitHubLogins`; display success toast with result counts (enriched, manuallyMatched, created, imported)

**Checkpoint**: US4 complete — full bulk resolution flow with progress tracking, skip, undo, and confirm dialog. Commit after this phase.

---

## Phase 7: User Story 5 — Persistent Identity & Sync History (Priority: P2)

**Goal**: Ensure manual matches persist across syncs (auto-match in future) and sync history displays new metrics.

**Independent Test**: Perform a sync with manual matches → run a second sync → verify previously matched members now auto-match → check sync history shows manuallyMatched and created counts.

### Implementation for User Story 5

- [ ] T022 [US5] Update sync event metrics recording in `confirmGitHubSync` in src/actions/github-sync.ts: set `manuallyMatchedCount` and `createdCount` on the `githubSyncEvents` insert/update; ensure `unmatchedCount` correctly reflects only truly unresolved members (total - auto-matched - manually matched - created - imported)
- [ ] T023 [US5] Update `getSyncHistory` in src/actions/github-sync.ts to include `manuallyMatchedCount` and `createdCount` in the returned sync event data; update the sync history display in src/app/settings/integrations/github-integration-client.tsx to show these new metrics alongside existing matched/imported/unmatched counts

**Checkpoint**: US5 complete — persistence verified across syncs, history shows full metrics. Commit after this phase.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Testing, accessibility, and final validation

- [ ] T024 [P] Create unit tests for match suggestion scoring in tests/unit/match-suggestions.test.ts: test exact name match scores highest, partial name match scored by Dice coefficient, email domain match scoring, inactive users sorted lower at equal scores, empty/null fields handled gracefully, top 3 limit enforced
- [ ] T025 [P] Accessibility review of all new components: verify keyboard navigation through unmatched member cards and action buttons, focus management when expanding/collapsing inline forms and combobox, ARIA labels on resolution status badges, screen reader announcements for progress summary updates, color-independent status indicators for inactive users and resolution states
- [ ] T026 Run quickstart.md validation flow end-to-end: verify pnpm typecheck passes, pnpm lint passes, dev server starts without errors, manual testing of the full sync → resolve → confirm → re-sync flow per quickstart.md verification steps

**Checkpoint**: All stories validated, tests passing, accessible. Final commit.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (needs string-similarity installed and schema updated)
- **US1 (Phase 3)**: Depends on Phase 2 (needs types, match-suggestions utility)
- **US2 (Phase 4)**: Depends on Phase 3 (needs unmatched-member-card component and pendingResolutions state)
- **US3 (Phase 5)**: Depends on Phase 3 (needs unmatched-member-card component); can run in parallel with US2
- **US4 (Phase 6)**: Depends on Phase 4 + Phase 5 (needs all resolution types wired up)
- **US5 (Phase 7)**: Depends on Phase 4 + Phase 5 (needs confirmGitHubSync extensions)
- **Polish (Phase 8)**: Depends on all story phases complete

### User Story Dependencies

- **US1 (P1)**: Foundation only — no story dependencies
- **US2 (P1)**: Depends on US1 (needs card component + state)
- **US3 (P1)**: Depends on US1 (needs card component + state); **parallel with US2**
- **US4 (P2)**: Depends on US2 + US3 (needs all resolution types available)
- **US5 (P2)**: Depends on US2 + US3 (needs confirm action fully extended)

### Within Each User Story

- Types/schemas before components
- Components before integration into parent page
- Client-side before server-side persistence
- Commit after each phase checkpoint

### Parallel Opportunities

- T004, T005, T006 can all run in parallel (different files)
- T008 (card component) runs in parallel with nothing in its phase, but T011 (combobox) and T014 (inline form) are parallel with each other across US2/US3
- T017, T018 can run in parallel (progress bar and skip button are independent)
- T024, T025 can run in parallel (unit tests and accessibility review)
- **US2 and US3 can run in parallel** after US1 completes (different components, different server action extensions)

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tasks together (different files):
Task: "Add types to src/types/index.ts"                    # T004
Task: "Add Zod schemas to src/lib/validators.ts"           # T005
Task: "Create src/lib/match-suggestions.ts"                # T006
# Then sequentially:
Task: "Create searchUsersForMatching in src/actions/github-sync.ts"  # T007 (depends on T005 for schema)
```

## Parallel Example: US2 + US3 (after US1)

```bash
# These can run in parallel (different components + different action extensions):
# US2 track:
Task: "Create user-search-combobox.tsx"                    # T011
Task: "Add match flow to unmatched-member-card"            # T012
Task: "Extend confirmGitHubSync for manualMatches"         # T013

# US3 track (parallel):
Task: "Create inline-user-form.tsx"                        # T014
Task: "Add create flow to unmatched-member-card"           # T015
Task: "Extend confirmGitHubSync for newUsers"              # T016
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (install dep + migration)
2. Complete Phase 2: Foundational (types, utils, search action)
3. Complete Phase 3: US1 (unmatched member cards with suggestions)
4. **STOP and VALIDATE**: Sync preview shows unmatched members with suggestions
5. Demo: admins can see who's unmatched and potential matches

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Unmatched members visible with suggestions → **Demo (MVP!)**
3. Add US2 → Manual matching works → Demo
4. Add US3 → Inline user creation works → Demo
5. Add US4 → Bulk flow with progress/confirm → Demo
6. Add US5 → Persistence verified, history updated → Demo
7. Polish → Tests, accessibility, validation → **Release**

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each phase checkpoint (8 commits total)
- US2 and US3 are the best parallel opportunity — different components, different server action code paths
- The `pendingResolutions` Map is the central client state — all resolution UIs write to it, the confirm button reads from it
- Existing `importGitHubLogins` flow is preserved for backwards compatibility (legacy bulk import)
