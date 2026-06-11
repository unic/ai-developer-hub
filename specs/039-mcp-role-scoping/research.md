# Research: Role-Scoped MCP Tools

**Feature**: 039-mcp-role-scoping | **Date**: 2026-06-11

No NEEDS CLARIFICATION markers remained in the technical context; research consolidated the design decisions below from the 038 codebase, the MCP SDK, and the Hub's existing role-gating patterns.

## R1. Where to enforce the role: tool layer, not transport layer

**Decision**: Enforce per-invocation inside the tool handlers (via a shared wrapper), not by varying the registered tool set per credential.

**Rationale**: `createMcpHandler` registers tools in a callback that has no access to the request's `AuthInfo` — the tool list is static per server instance. The MCP SDK does pass `RequestHandlerExtra.authInfo` to every tool callback (`@modelcontextprotocol/sdk` `shared/protocol.d.ts:181`), which `mcp-handler`'s `withMcpAuth` populates from our `verifyMcpToken`. Invocation-time enforcement is therefore the natural seam, costs nothing, and keeps discovery behaviour identical for all clients (documented in the spec as acceptable: tool names leak no data).

**Alternatives considered**:
- *Per-credential server construction* (rebuild the tool set per request based on role): fights mcp-handler's design, complicates caching, and still requires invocation checks as defense in depth — rejected.
- *Scope-based enforcement* (issue `mcp:read:admin` vs `mcp:read` scopes at token time): freezes the role into the token, violating FR-002 (live role resolution); a demoted admin would keep admin scope for up to 60 days of refresh lifetime — rejected.

## R2. How the role reaches the tool handler

**Decision**: Add `role` to the existing `verifyAccessToken` projection (`users` is already inner-joined) → `VerifiedAccessToken.role` → `AuthInfo.extra.role`. Shared-secret path sets `extra: { role: "admin" }` explicitly.

**Rationale**: Zero extra queries; the same SELECT that enforces `users.status = 'active'` now carries the live role. The shared secret being *explicitly* admin (rather than admin-by-fallback) lets the parser default unknown/missing roles to viewer — least privilege (FR-011) without breaking the org credential.

**Alternatives considered**:
- *Separate role lookup in each tool handler*: N extra queries and N chances to forget — rejected.
- *Role in the JWT/token record at issuance*: violates FR-002 (live resolution) — rejected.

## R3. Denial shape

**Decision**: Tool-level `errorResult(...)` (`isError: true` content) with one shared message constant naming the required role and what viewers can still use. Never a protocol-level error or HTTP 403.

**Rationale**: Matches 038's "thrown errors degrade to isError results" philosophy (`safeJsonResult`); assistants can read the text and explain the refusal to their user (FR-012). A protocol error would surface as a generic failure in Claude clients. The message contains no organizational data (FR-006).

**Alternatives considered**: MCP `-32603` protocol errors (opaque to end users), HTTP 403 at transport (kills the whole session rather than the one call) — both rejected.

## R4. Self-scoping semantics for personal tools

**Decision**: `get_user_cost_profile.email` becomes optional, defaulting to the token owner. Viewers passing a non-own email get an explicit refusal (never silent substitution). `list_license_assignments` pins the email filter to the owner for viewers; other filters still apply. Email comparison is trim + case-insensitive.

**Rationale**: Omitted-email-defaults-to-self makes the common viewer ask ("what am I costing?") work first try (SC-003) and is also a UX improvement for admins. Refusal-over-substitution keeps behaviour transparent to the calling assistant (spec US2). The shared secret has no owner, so an omitted email there is a validation error asking for one — preserving 034-era explicit-email usage exactly.

**Alternatives considered**: Silently coercing a viewer's foreign-email request to their own data (confusing, looks like a wrong answer); keeping email required (breaks SC-003's "no identity argument" outcome) — both rejected.

## R5. Viewer view of the AI tool catalog

**Decision**: `list_ai_tools` stays viewer-accessible but omits `activeAssignments`, `maxLicenses`, and `licenseUtilizationPct` (and skips the aggregate query) for viewers.

**Rationale**: Direct parity with the web UI — `/tools` renders for any authenticated user but the page deliberately skips license-count queries for non-admins ("Viewers don't see the license count column", `src/app/tools/page.tsx:14`). Tier pricing remains visible to viewers, exactly as the tools table shows it.

**Alternatives considered**: Making list_ai_tools admin-only (stricter than the web UI — violates the parity principle); returning zeroed counts like the page's internal placeholder (lying in an API response) — both rejected.

## R6. Tool-to-class mapping audit (web-UI parity)

Verified against the App Router role gates:

| MCP tool | Web-UI parity source | Class |
|---|---|---|
| get_claude_spend_summary, list_claude_workspaces, list_claude_users, get_claude_cost_dashboard | `/claude/*` pages redirect non-admins (`claude/page.tsx:31`, `claude/users/page.tsx:45`, `claude/workspaces/[id]/page.tsx:24`) | admin-only |
| get_budget_status, get_budget_report | `/budget`, `/reports` admin-gated (`reports/layout.tsx:11`) | admin-only |
| get_copilot_usage_summary, get_copilot_analytics | `/copilot/layout.tsx:11` redirects non-admins | admin-only |
| list_invoices, list_recent_sync_events | invoice/sync surfaces live under admin settings/ingestion history | admin-only |
| find_users | `/users` wrapped in `AuthGuard requiredRole="admin"` (`users/page.tsx:17`) | admin-only |
| get_user_cost_profile, list_license_assignments | viewer dashboard/profile shows own data only (`actions/dashboard.ts` role filter, `actions/anthropic-usage.ts`) | self-scoped |
| list_ai_tools | `/tools` viewer-visible minus license counts (`tools/page.tsx:14-22`) | viewer-safe catalog |
