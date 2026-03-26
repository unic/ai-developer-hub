# Tasks: Profile API Preview

**Input**: Design documents from `/specs/022-profile-api-preview/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create new files and export shared validators needed by all stories

- [ ] T001 [P] Create server action `previewProfileApi` in `src/actions/profile-api-preview.ts` — accepts `{ email: string; month?: string }`, constructs base URL (NEXTAUTH_URL || VERCEL_URL || localhost:3000), calls `GET /api/profile?email=...&month=...` with Bearer `PROFILE_API_SECRET` header, measures response time via `performance.now()`, returns `{ status, statusText, responseTimeMs, body }` typed as `ApiPreviewResponse`. Include check: if `PROFILE_API_SECRET` is not set, return early with `{ success: false, error: "PROFILE_API_SECRET is not configured" }`. Validate inputs with Zod before sending.
- [ ] T002 [P] Ensure `src/lib/validators.ts` exports reusable `emailSchema` (z.string().email()) and `monthSchema` (z.string().regex for YYYY-MM) — if these already exist as inline schemas, extract and export them so the server action and client form can share them.
- [ ] T003 [P] Add "API Preview" entry to the `adminTabs` array in `src/app/settings/settings-nav.tsx` — add `{ title: "API Preview", href: "/settings/api-preview" }` following the existing pattern for Integrations and Sync Status tabs.

**Checkpoint**: Server action callable, validators exported, nav link visible to admins. Commit.

---

## Phase 2: Foundational (JSON Viewer Component)

**Purpose**: Build the reusable JSON viewer that all user stories depend on for displaying responses

**⚠️ CRITICAL**: US1, US2, US3 all need this component to render API responses

- [ ] T004 Create recursive JSON viewer component in `src/components/ui/json-viewer.tsx` — a `"use client"` component that accepts a `data: unknown` prop and renders JSON with: (a) syntax highlighting via Tailwind color classes — strings in green, numbers in blue, booleans in purple, null in gray, keys in the default foreground; (b) proper indentation with 2-space nesting; (c) object/array brackets with item counts shown when collapsed; (d) each object/array node is collapsible via chevron icon (ChevronRight/ChevronDown from Lucide) toggled by clicking the key or chevron; (e) top-level nodes default to expanded, deeper nodes (depth > 2) default to collapsed; (f) keyboard accessible — chevron toggles focusable and operable via Enter/Space. Export as named export `JsonViewer`.

**Checkpoint**: JSON viewer renders any valid JSON with syntax highlighting and collapse/expand. Commit.

---

## Phase 3: User Story 1 — Test Profile API with Email Lookup (Priority: P1) 🎯 MVP

**Goal**: Admin can enter an email, submit, and see the real API response formatted with status code and timing.

**Independent Test**: Navigate to Settings > API Preview, enter a valid user email, submit, verify formatted JSON response with status 200 and response time displayed. Then try a nonexistent email and verify 404 error response.

### Implementation for User Story 1

- [ ] T005 [US1] Create server component page at `src/app/settings/api-preview/page.tsx` — call `requireAdmin()` (from `src/lib/auth-helpers.ts`), redirect to `/settings/appearance` if not admin, check if `PROFILE_API_SECRET` env var is set and pass `isConfigured` boolean as prop. Render `ApiPreviewClient` component.
- [ ] T006 [US1] Create client component `src/components/settings/api-preview-client.tsx` — a `"use client"` component that renders: (a) a Card with title "API Preview" and description "Test the profile API endpoint"; (b) an email Input field (required) with Label, validated on blur with the shared `emailSchema`; (c) a "Send Request" Button that calls the `previewProfileApi` server action; (d) loading state: Button disabled with Loader2 spin animation while request is in flight; (e) response area: when a response exists, show a Badge with HTTP status code (green variant for 2xx, destructive for 4xx/5xx) + status text + response time in ms; (f) below the status Badge, render the `JsonViewer` component with the response body; (g) if `isConfigured` is false, show an Alert warning that `PROFILE_API_SECRET` is not set and disable the form. Use shadcn/ui Card, Input, Label, Button, Badge, Alert components. Import toast from sonner for error notifications.

**Checkpoint**: Full P1 flow works — admin enters email, sees formatted JSON response with status and timing. Error responses display correctly. Commit.

---

## Phase 4: User Story 2 — Filter by Month Parameter (Priority: P2)

**Goal**: Admin can optionally enter a month (YYYY-MM) to filter cost data in the API response.

**Independent Test**: Enter a valid email plus a month value (e.g., `2026-01`), submit, verify `costData.month` in the response matches. Enter an invalid month format and verify client-side validation error appears.

### Implementation for User Story 2

- [ ] T007 [US2] Add month input field to `src/components/settings/api-preview-client.tsx` — add an optional Input field with Label "Month (optional)" and placeholder "YYYY-MM", validated on blur with the shared `monthSchema` (allow empty). On submit, pass month value to the `previewProfileApi` server action alongside email. Show inline validation error under the field if format is invalid.

**Checkpoint**: Month parameter flows through to API call, validation works client-side. Commit.

---

## Phase 5: User Story 3 — Copy and Inspect Response (Priority: P3)

**Goal**: Admin can copy the raw JSON to clipboard and collapse/expand top-level sections of the response.

**Independent Test**: Submit a request, click "Copy JSON" button, paste into editor and verify valid JSON. Click section headers in the JSON viewer to collapse/expand.

### Implementation for User Story 3

- [ ] T008 [US3] Add copy-to-clipboard button to the response area in `src/components/settings/api-preview-client.tsx` — add a Button (variant outline, size sm) with Copy icon (from Lucide) next to the status Badge. On click, call `navigator.clipboard.writeText(JSON.stringify(response.body, null, 2))`, show `toast.success("JSON copied to clipboard")`, swap icon to Check for 2 seconds (use local state with setTimeout), handle clipboard errors with `toast.error`. Follow the existing pattern from `src/components/invite-link-dialog.tsx`.

**Checkpoint**: Copy works, JSON viewer collapse/expand already functional from T004. All three user stories complete. Commit.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [ ] T009 Run `pnpm typecheck` and fix any TypeScript errors across all new files
- [ ] T010 Run `pnpm lint` and fix any ESLint warnings across all new files
- [ ] T011 Verify quickstart.md manual test steps pass — walk through all scenarios in `specs/022-profile-api-preview/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001, T002, T003 all run in parallel
- **Foundational (Phase 2)**: T004 has no dependency on Phase 1 — can run in parallel with Setup
- **User Story 1 (Phase 3)**: Depends on T001 (server action), T002 (validators), T003 (nav link), T004 (JSON viewer)
- **User Story 2 (Phase 4)**: Depends on T006 (US1 client component) since it modifies the same file
- **User Story 3 (Phase 5)**: Depends on T006 (US1 client component) since it modifies the same file
- **Polish (Phase 6)**: Depends on all user stories complete

### User Story Dependencies

- **User Story 1 (P1)**: Requires Phase 1 + Phase 2 complete. No dependencies on other stories.
- **User Story 2 (P2)**: Adds to the client component built in US1. Must follow US1.
- **User Story 3 (P3)**: Adds to the client component built in US1. Must follow US1 (can parallel with US2 but touches same file, so sequential is safer).

### Parallel Opportunities

```
Phase 1 + Phase 2 can run fully in parallel:
  T001 ─┐
  T002 ─┼─ all parallel (different files)
  T003 ─┤
  T004 ─┘

Phase 3 (US1) after Phase 1+2:
  T005 ─┐
  T006 ─┘ sequential (T006 imports from T005's page)

Phase 4 (US2) after Phase 3:
  T007 (modifies T006's file)

Phase 5 (US3) after Phase 4:
  T008 (modifies T006's file)

Phase 6 after all:
  T009 ─┐
  T010 ─┤ parallel (independent checks)
  T011 ─┘
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001-T003) + Phase 2 (T004) in parallel
2. Complete Phase 3: User Story 1 (T005-T006)
3. **STOP and VALIDATE**: Enter email, see response, verify error handling
4. Commit and deploy if ready — this alone delivers the core value

### Incremental Delivery

1. Setup + Foundational → Commit
2. User Story 1 → Commit → MVP ready
3. User Story 2 (add month field) → Commit
4. User Story 3 (add copy button) → Commit
5. Polish → Final commit

---

## Notes

- Commit after each checkpoint as requested
- T001-T004 are all in different files and can be dispatched as parallel subagents
- T005-T006 are sequential (page renders client component)
- T007 and T008 each modify the same client component file, so must be sequential
- No database migrations or schema changes needed
- No new npm dependencies needed
