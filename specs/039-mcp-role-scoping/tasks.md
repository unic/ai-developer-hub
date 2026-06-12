# Tasks: Role-Scoped MCP Tools

**Input**: Design documents from `/specs/039-mcp-role-scoping/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tool-authorization.md, quickstart.md

**Tests**: Included — the constitution mandates unit coverage for shared business logic, and the spec's success criteria (SC-001/002/004) are verified through the unit matrix.

**Organization**: Tasks grouped by user story. US3 (live role resolution) is satisfied structurally by the foundational phase; its phase contains the proving tests.

## Phase 1: Setup

*No setup tasks — existing project, no new packages, no schema changes. Branch `039-mcp-role-scoping` already created from `038-mcp-oauth-and-tools`.*

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Put the live role into the caller context every story depends on.

- [x] T001 Add `role` to the `verifyAccessToken` projection and `VerifiedAccessToken` interface in `src/lib/oauth/store.ts` (column rides the existing `users` inner join; type `"admin" | "viewer"` from the `user_role` enum)
- [x] T002 Surface the role in `AuthInfo.extra` in `src/lib/mcp/auth.ts`: OAuth path adds `role: verified.role`; shared-secret path adds `extra: { role: "admin" }` (explicit admin-equivalence per FR-004)
- [x] T003 Create pure authorization module `src/lib/mcp/access.ts`: `McpRole`, `McpCaller`, `callerFromAuthInfo` (anything but literal `"admin"` → viewer, FR-011), `ADMIN_REQUIRED_MESSAGE` constant, `adminOnly(handler)` higher-order wrapper returning `errorResult(ADMIN_REQUIRED_MESSAGE)` for non-admins, and `resolveSelfEmail(caller, requestedEmail?)` implementing the identity-pinning matrix (trim + case-insensitive; viewer foreign email → refusal; shared-secret omitted email → explicit-email validation error)
- [x] T004 [P] Unit-test the pure module in `tests/unit/mcp/access.test.ts`: role parsing (admin / viewer / missing extra / unknown role / shared-secret extra), full `resolveSelfEmail` matrix incl. case-variant and whitespace-variant emails (SC-004)

**Checkpoint**: `pnpm test tests/unit/mcp/access.test.ts` green; role is available to every tool handler.

## Phase 3: User Story 1 — Viewer tokens stop receiving org-wide admin data (P1) 🎯 MVP

**Goal**: The 11 org-wide tools refuse viewer credentials with the shared structured error; admin and shared-secret behaviour unchanged.

**Independent Test**: With a viewer-role authInfo, each admin-only tool returns `isError` and never calls its data function; with admin/shared-secret authInfo, results are unchanged from 038.

- [x] T005 [US1] Wrap the 11 admin-only tool handlers in `adminOnly(...)` in `src/lib/mcp/tools.ts` (get_claude_spend_summary, list_claude_workspaces, list_claude_users, get_claude_cost_dashboard, get_budget_status, get_budget_report, get_copilot_usage_summary, get_copilot_analytics, list_invoices, list_recent_sync_events, find_users); handlers receive the SDK's second `extra` argument and pass `extra.authInfo` to the wrapper
- [x] T006 [US1] Append the discovery hint "Requires an admin-role token." to the 11 admin-only tool descriptions in `src/lib/mcp/tools.ts`
- [x] T007 [US1] Extend `tests/unit/mcp/tools.test.ts` with the role matrix for admin-only tools: viewer authInfo → `isError: true`, shared message, mocked data fn **not called** (FR-005/006); admin authInfo and shared-secret authInfo → data fn called, result unchanged (FR-003, SC-002); every registered tool name must appear in exactly one access-class list (guards future tools, plan §7 risk 1)

**Checkpoint**: US1 fully testable on its own — viewer denial + admin no-regression proven.

## Phase 4: User Story 2 — Personal tools self-scoped for viewers (P2)

**Goal**: Viewers keep their own cost profile, assignments, and a utilization-free catalog; identity can never be spoofed via the email argument.

**Independent Test**: Viewer authInfo: omitted email → own data; foreign email → refusal; list_ai_tools → no utilization fields. Admin/shared-secret: unchanged (shared-secret profile call without email → explicit-email error).

- [x] T008 [US2] Make `email` optional on `get_user_cost_profile` (`z.string().email().optional()`) and resolve it through `resolveSelfEmail` before calling `getUserCostProfileData` in `src/lib/mcp/tools.ts`; update the tool description ("Defaults to the user bound to your token; admins may query any email.")
- [x] T009 [US2] Pin the viewer's `email` filter in `list_license_assignments` via `resolveSelfEmail` in `src/lib/mcp/tools.ts` (foreign email → refusal; omitted → own; non-identity filters still apply within self-scope, FR-009); admin/shared-secret filters pass through unchanged
- [x] T010 [US2] Add `includeUtilization` option to `listAiToolsData` in `src/lib/mcp/data.ts`: when false, skip the `licenseAssignments` aggregate query and omit `activeAssignments`/`maxLicenses`/`licenseUtilizationPct` from the per-tool payload (strict typing, no `any`); wire `includeUtilization: caller.role === "admin"` from the `list_ai_tools` handler in `src/lib/mcp/tools.ts`
- [x] T011 [US2] Extend `tests/unit/mcp/tools.test.ts` for self-scoping: profile omitted-email default (SC-003), viewer foreign-email refusal with no data-fn call (SC-004), viewer own-email case-insensitive pass, assignments pinning incl. filter passthrough, catalog `includeUtilization` flag per role, shared-secret profile-without-email validation error

**Checkpoint**: Viewer experience complete and locked down; admin/shared-secret behaviour proven unchanged.

## Phase 5: User Story 3 — Role changes take effect immediately (P3)

**Goal**: Prove the live-resolution property (delivered structurally by T001 — role is re-read per request, never cached or frozen).

**Independent Test**: Two consecutive verifications of the same token straddling a role flip produce different roles.

- [x] T012 [US3] Add unit coverage in `tests/unit/mcp/access.test.ts` (or `tools.test.ts`) asserting enforcement uses the per-request authInfo role only — same tool, same token context, role flipped between calls → access flips (SC-005); confirm no module-level caching of caller/role exists in `src/lib/mcp/access.ts`

**Checkpoint**: All three stories independently verified.

## Phase 6: Polish & Cross-Cutting

- [x] T013 Run verification gates: `pnpm test` (full unit suite), `pnpm typecheck`, `pnpm lint` — all zero-error/zero-warning (constitution gate)
- [x] T014 [P] Manual probe per `specs/039-mcp-role-scoping/quickstart.md` against a local dev server — done for the shared-secret credential (admin data flows, profile-without-email validation error, catalog utilization present) plus a bogus-OAuth-token 401; the viewer-token live probe was skipped (minting one requires forging token rows in the shared preview DB — declined by policy; viewer path is pinned by the unit matrix over the same authInfo channel proven live)
- [x] T015 [P] Write `specs/039-mcp-role-scoping/implementation-notes.html` (038-style running notes: decisions, deviations from plan, open questions) and update the 038 notes' open question with a pointer to this feature

## Dependencies & Execution Order

- **Phase 2 → everything**: T001 → T002 → T003 (sequential, same dependency chain); T004 parallel with T005+ once T003 lands.
- **US1 (T005–T007)**: depends on T003 only. **MVP scope.**
- **US2 (T008–T011)**: depends on T003; independent of US1 (different handlers), but touches the same file `src/lib/mcp/tools.ts` — execute after US1 to avoid edit conflicts, or interleave carefully.
- **US3 (T012)**: test-only; depends on Phase 2.
- **Polish (T013–T015)**: after all stories.

## Parallel Opportunities

- T004 (access tests) ∥ T005–T006 (tools wiring) once T003 is done.
- T014 ∥ T015 after T013.
- US2's data.ts change (T010, first half) ∥ US1's tools.ts edits if split by file.

## Implementation Strategy

MVP = Phase 2 + US1 (viewer denial on org-wide tools) — that alone closes the security gap. US2 restores viewer usefulness (self-scoped tools), US3 is proof of the live-role property. Single PR is appropriate given the small surface (~5 files), but each phase checkpoint is independently green.
