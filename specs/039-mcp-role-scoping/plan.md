# Implementation Plan: Role-Scoped MCP Tools

**Branch**: `039-mcp-role-scoping` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/039-mcp-role-scoping/spec.md`

## Summary

Close the open question from feature 038: MCP tool access must respect the hub user role bound to the OAuth token. The role is resolved live in `verifyAccessToken` (which already joins `users`), surfaced through `AuthInfo.extra`, and enforced by a small pure authorization module (`src/lib/mcp/access.ts`) that classifies the 14 tools into three access classes — **admin-only** (11 tools, denied to viewers with a structured tool error), **self-scoped** (`get_user_cost_profile`, `list_license_assignments` — pinned to the token owner for viewers), and **viewer-safe catalog** (`list_ai_tools` — license utilization stripped for viewers). The shared-secret credential is explicitly admin-equivalent. No schema changes, no new packages, no new endpoints.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), `mcp-handler` 1.1.0, `@modelcontextprotocol/sdk` (via mcp-handler), Drizzle ORM 0.45.1, Zod 4.3.6
**Storage**: Neon PostgreSQL (serverless) — **no schema changes**; `users.role` (`user_role` enum: `admin` | `viewer`) is the existing source of truth
**Testing**: Vitest unit tests (fake `ToolRegistrar` pattern from 038, data layer mocked); no integration-test changes needed
**Target Platform**: Vercel (Fluid Compute), same MCP endpoint `/api/mcp/[transport]`
**Project Type**: Web application (single Next.js project)
**Performance Goals**: Zero additional DB queries per tool call (role rides the existing `verifyAccessToken` join; viewer catalog path actually drops one query)
**Constraints**: Admin behaviour byte-compatible with 038; denial is a tool-level `isError` result, never a protocol error; least-privilege default for unknown roles
**Scale/Scope**: 14 tools, ~5 source files touched, 1 new source module, 1 new test file

## Constitution Check

*GATE: evaluated pre-Phase-0 and re-checked post-design — PASS, no violations.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Type-Safe Code Quality | PASS | New `McpRole`/`McpCaller` types exported; no `any`; new pure module fully unit-tested; existing tool tests extended for both roles |
| II. UX Consistency | PASS (N/A surface) | No web UI changes. The MCP "UX" follows the parity principle: identical role semantics as the web UI |
| III. Performance Budgets | PASS | No new routes/bundles. Role adds one column to an existing joined SELECT; viewer catalog skips the assignment-count aggregate |
| IV. Accessibility-First | PASS (N/A) | No user-facing UI |
| V. Simplicity & Maintainability | PASS | One new ~80-line pure module instead of scattering role checks; no new deps; no speculative third role |

## Project Structure

### Documentation (this feature)

```text
specs/039-mcp-role-scoping/
├── spec.md                  # Feature specification
├── plan.md                  # This file
├── implementation-plan.html # Stakeholder-readable HTML rendition of this plan
├── research.md              # Phase 0 — decisions & alternatives
├── data-model.md            # Phase 1 — access classes, caller model
├── quickstart.md            # Phase 1 — how to exercise role scoping locally
├── contracts/
│   └── tool-authorization.md  # Per-tool access matrix + denial contract
├── checklists/
│   └── requirements.md      # Spec quality checklist (complete)
└── tasks.md                 # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── oauth/
│   │   └── store.ts            # MODIFIED: verifyAccessToken selects users.role; VerifiedAccessToken.role
│   ├── mcp/
│   │   ├── auth.ts             # MODIFIED: role into AuthInfo.extra (OAuth) + admin-equivalent extra for shared secret
│   │   ├── access.ts           # NEW: pure role/caller helpers — callerFromAuthInfo, requireAdmin wrapper, resolveSelfEmail
│   │   ├── tools.ts            # MODIFIED: handlers consume extra.authInfo; admin gating; self-scoping; viewer catalog flag
│   │   ├── data.ts             # MODIFIED: listAiToolsData({ includeUtilization }) — viewer variant skips/strips utilization
│   │   └── format.ts           # unchanged (errorResult reused for denials)
│   └── db/schema.ts            # unchanged (user_role enum already exists)
└── app/api/mcp/[transport]/route.ts  # unchanged

tests/
└── unit/mcp/
    ├── access.test.ts          # NEW: pure helper coverage (role parsing, self-scope resolution, least privilege)
    └── tools.test.ts           # MODIFIED: per-tool admin/viewer matrix, self-scoping, catalog stripping, shared-secret
```

**Structure Decision**: Single Next.js project (existing). All enforcement lives in the MCP layer (`src/lib/mcp/`); the OAuth store only gains one selected column. No route, schema, or migration changes.

## Design

### D1. Role resolution (live, per request)

`verifyAccessToken` already inner-joins `users` and filters on `users.status = 'active'`. Add `role: users.role` to the projection and to `VerifiedAccessToken`. The role is therefore re-read from the live user row on **every** MCP request — demotion/promotion applies to outstanding tokens immediately (FR-002), with zero added query cost.

### D2. AuthInfo.extra contract

`verifyMcpToken` (src/lib/mcp/auth.ts) becomes the single place that translates credentials into a caller context:

- **OAuth path**: `extra: { userId, email, name, role }` — role from D1.
- **Shared-secret path**: `extra: { role: "admin" }` — explicit admin-equivalence (FR-004); no user identity.

Downstream, `callerFromAuthInfo` treats `extra.role === "admin"` as admin and **anything else** (missing extra, unknown value) as viewer — least privilege (FR-011). The shared secret is admin because it says so explicitly, not because of a fallback.

### D3. Authorization module (`src/lib/mcp/access.ts`, new)

Pure, no I/O — mirrors the `format.ts` testability philosophy:

- `type McpRole = "admin" | "viewer"`
- `interface McpCaller { role: McpRole; userId?: number; email?: string }`
- `callerFromAuthInfo(authInfo?: AuthInfo): McpCaller`
- `ADMIN_REQUIRED_MESSAGE` — one consistent denial string naming the required role and the tools viewers *can* use (FR-012, no data in payload per FR-006)
- `adminOnly(handler)` — higher-order wrapper: deny with `errorResult(ADMIN_REQUIRED_MESSAGE)` unless caller is admin, else run the wrapped handler
- `resolveSelfEmail(caller, requestedEmail?)` — identity pinning for self-scoped tools:
  - admin: `requestedEmail ?? caller.email`; if neither exists (shared secret, no arg) → validation error asking for an explicit email
  - viewer: requested email must equal own email case-insensitively (trimmed), else denial error; omitted → own email

### D4. Per-tool enforcement (tools.ts)

Tool callbacks already receive `RequestHandlerExtra` (with `authInfo`) as their second argument from the MCP SDK — `withMcpAuth` populates it; no transport changes needed.

| Class | Tools | Enforcement |
|---|---|---|
| Admin-only (11) | get_claude_spend_summary, list_claude_workspaces, list_claude_users, get_claude_cost_dashboard, get_budget_status, get_budget_report, get_copilot_usage_summary, get_copilot_analytics, list_invoices, list_recent_sync_events, find_users | Wrap handler in `adminOnly(...)`; append "Requires an admin-role token." to description so assistants stop calling them speculatively |
| Self-scoped (2) | get_user_cost_profile (email becomes **optional** in the input schema, defaulting to the token owner), list_license_assignments (viewer's `email` filter pinned to own email) | `resolveSelfEmail` before the data call |
| Viewer-safe catalog (1) | list_ai_tools | Pass `includeUtilization: caller.role === "admin"`; viewer responses omit `activeAssignments` / `maxLicenses` / `licenseUtilizationPct` and skip the count aggregate query (FR-010, mirrors `/tools` page) |

### D5. Data layer change (data.ts)

Only `listAiToolsData` changes: accept `{ includeUtilization: boolean }`. When false, skip the `licenseAssignments` aggregate and return tools without the three utilization fields (typed via a union or conditional return — strict mode, no `any`). `getUserCostProfileData` / `listLicenseAssignmentsData` signatures stay; the *handler* supplies the resolved/pinned email.

### D6. Test plan

- `tests/unit/mcp/access.test.ts` (new): role parsing (admin / viewer / missing / unknown / shared-secret extra), `resolveSelfEmail` matrix (admin+email, admin no-identity error, viewer omitted→self, viewer own-email case-insensitive, viewer other-email denial).
- `tests/unit/mcp/tools.test.ts` (extended): the registration assertions stay; add an authInfo-context matrix — each of the 11 admin tools returns `isError` + no data-fn call for viewer authInfo, succeeds for admin and shared-secret authInfo; self-scoped tools forward pinned email; viewer catalog passes `includeUtilization: false`; missing role → viewer semantics.
- Existing admin-path assertions prove FR-003 (no admin regression).

## Complexity Tracking

No constitution violations — table not required.
