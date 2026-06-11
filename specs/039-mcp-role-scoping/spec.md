# Feature Specification: Role-Scoped MCP Tools

**Feature Branch**: `039-mcp-role-scoping`
**Created**: 2026-06-11
**Status**: Draft
**Input**: User description: "Role-scoped MCP tools: MCP tool access must respect the hub user role (admin vs viewer) bound to the OAuth access token, instead of every authenticated MCP credential seeing all org-wide read-only data. Admin-role tokens keep full access to all 14 tools. Viewer-role tokens must not receive admin/org-wide data: org-wide spend, budget, workspace, Copilot, invoice, sync and user-directory tools are denied with a clear authorization error, while personal tools (user cost profile, license assignments) are automatically scoped to the token owner's own identity — a viewer cannot query another user's data even by passing a different email. The shared-secret credential (spec 034 model, org-level secret) remains admin-equivalent. Role must be resolved live from the users table at token verification time (not frozen into the token), so demoting a user takes effect on their existing tokens immediately. Follows up the open question recorded in specs/038-mcp-v2 implementation notes."

## Context

Feature 038 (MCP v2) shipped an embedded OAuth authorization server for the Hub's MCP endpoint: access tokens are now bound to an individual hub user, and the token verifier already exposes that user's identity to every tool invocation. However, the authorization model was deliberately left unchanged from spec 034's shared-secret era: **any authenticated MCP credential reads the same org-wide data an admin sees**, regardless of the bound user's role. The 038 implementation notes record this as an explicit open question. This feature closes it: MCP tool access must mirror the role model the Hub web UI already enforces.

The guiding principle is **parity with the web UI**: a viewer connecting an AI assistant over MCP must see no more than that same viewer sees when logged into the Hub in a browser, and an admin must lose nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Viewer tokens stop receiving org-wide admin data (Priority: P1)

A hub user with the viewer role has connected an AI assistant to the Hub via MCP OAuth. When their assistant invokes a tool that returns org-wide financial or operational data (organization spend summaries, budget status and reports, workspace lists, per-user spend rankings, Copilot analytics, invoices, sync events, or user-directory search), the call is refused with a clear authorization message instead of returning the data.

**Why this priority**: This is the security gap the feature exists to close — viewer credentials currently read org-wide per-user spend and budget data that the web UI only shows to admins. Everything else in this feature is refinement around this core restriction.

**Independent Test**: Authenticate against the MCP endpoint with a token bound to a viewer-role user, invoke each org-wide tool, and confirm each returns an authorization error (not data). Invoke the same tools with an admin-bound token and confirm full data is returned.

**Acceptance Scenarios**:

1. **Given** an MCP access token bound to a viewer-role user, **When** the assistant calls any admin-only tool (org spend summary, workspace list, per-user Claude spend, cost dashboard, budget status, budget report, Copilot usage, Copilot analytics, invoices, sync events, user search), **Then** the tool returns an error result clearly stating the tool requires the admin role, and no organizational data is included in the response.
2. **Given** an MCP access token bound to an admin-role user, **When** the assistant calls any of the 14 tools, **Then** the tool behaves exactly as before this feature (no regression in admin capability).
3. **Given** a viewer-bound token, **When** the assistant lists available tools, **Then** the denial on invocation is explicit enough that the assistant can explain to its user why the data is unavailable (the error names the required role).

---

### User Story 2 - Personal tools are self-scoped for viewers (Priority: P2)

A viewer-role user asks their AI assistant about their own AI tooling costs and license assignments. The personal tools (user cost profile, license assignment list) keep working for them — but only ever return the token owner's own data. If the viewer's assistant asks for another person's email, the call is refused rather than silently substituted.

**Why this priority**: Without this, role-scoping would reduce viewers to nothing useful — the personal cost profile is exactly the data the Hub web UI already shows a viewer about themselves. It must keep working, but must not become a loophole for reading colleagues' data.

**Independent Test**: With a viewer-bound token, request own cost profile and own license assignments (succeeds, returns only own data); request another user's email (refused with a clear error).

**Acceptance Scenarios**:

1. **Given** a viewer-bound token, **When** the assistant requests the user cost profile without specifying an email, **Then** the profile of the token owner is returned.
2. **Given** a viewer-bound token, **When** the assistant requests the cost profile or license assignments for an email other than the token owner's, **Then** the call is refused with an error explaining viewers can only access their own data, and none of the other user's data is returned.
3. **Given** a viewer-bound token, **When** the assistant lists license assignments, **Then** only assignments belonging to the token owner are returned, regardless of any filter arguments supplied.
4. **Given** an admin-bound token, **When** the assistant requests any user's cost profile or license assignments, **Then** the data is returned as before (admin behaviour unchanged).
5. **Given** a viewer-bound token, **When** the assistant lists the AI tool catalog, **Then** the catalog is returned without license utilization details (mirroring what the web UI shows viewers on the tools page).

---

### User Story 3 - Role changes take effect immediately on existing tokens (Priority: P3)

An admin demotes a user from admin to viewer (or deactivates them) in the Hub. The demoted user's previously issued MCP tokens immediately stop granting admin-level tool access — without waiting for token expiry and without the admin having to hunt down and revoke the user's MCP connections.

**Why this priority**: Live enforcement is what makes the role boundary trustworthy operationally; without it a demoted user could retain admin-level MCP access for up to the refresh-token lifetime (60 days).

**Independent Test**: Issue a token for an admin user, verify an admin-only tool succeeds, demote the user to viewer in the database, and verify the same token is now refused on that tool within the same minute.

**Acceptance Scenarios**:

1. **Given** a user with an active MCP token issued while they were an admin, **When** the user's hub role is changed to viewer, **Then** the very next invocation of an admin-only tool with that token is refused.
2. **Given** a user promoted from viewer to admin, **When** they next invoke an admin-only tool with an existing token, **Then** the call succeeds without re-authorization.
3. **Given** the org-level shared secret credential, **When** any tool is invoked with it, **Then** it continues to behave with full (admin-equivalent) access, matching the spec 034 model.

---

### Edge Cases

- **Shared-secret credential has no bound user**: it is admin-equivalent for all org-wide tools; for personal tools that default to "the token owner", it has no owner — a call without an explicit email is rejected with a validation message asking for one (admin-equivalent callers may query anyone explicitly).
- **Token owner's email passed explicitly by a viewer**: allowed — passing your own email is equivalent to passing none. Email comparison is case-insensitive.
- **Unknown or missing role** (defensive: a future role enum value, or role unexpectedly absent): treated as the least-privileged role (viewer semantics) — never as admin.
- **Tool discovery vs. invocation**: the MCP tool list is advertised identically to all authenticated credentials (the protocol's tool listing is not per-credential here); enforcement happens at invocation. Denial messages must therefore be self-explanatory.
- **Viewer passes filter arguments to a self-scoped tool** (e.g., a tool-name filter on license assignments): non-identity filters still apply within the self-scope; identity filters are pinned to the token owner.
- **Deactivated user**: already refused at token verification (existing 038 behaviour); this feature must not weaken that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every MCP tool invocation MUST be evaluated against the hub role (admin or viewer) of the user bound to the presenting credential before any data is fetched or returned.
- **FR-002**: The role used for enforcement MUST be resolved from the live user record at token verification time on every request — never from a value frozen into the token at issuance — so role changes and deactivation apply to all outstanding tokens immediately.
- **FR-003**: Admin-role credentials MUST retain the exact pre-feature behaviour of all 14 tools (no admin regression).
- **FR-004**: The org-level shared-secret credential MUST remain admin-equivalent for org-wide tools, but MUST require an explicit identity argument for personal tools that otherwise default to the token owner.
- **FR-005**: Viewer-role credentials MUST be denied the following org-wide tools with a structured tool error (not a protocol failure) that names the required role: organization Claude spend summary, Claude workspace list, per-user Claude spend list, Claude cost dashboard, budget status, budget report, Copilot usage summary, Copilot analytics, invoice list, sync event list, and user-directory search.
- **FR-006**: A denied invocation MUST NOT leak any organizational data in the error payload (no partial results, no counts, no names).
- **FR-007**: Viewer-role credentials MUST be able to invoke the personal tools (user cost profile, license assignments) and the AI tool catalog.
- **FR-008**: For viewer credentials, personal tools MUST be pinned to the token owner's identity: an omitted identity argument defaults to the token owner, the owner's own email (case-insensitive) is accepted, and any other identity is refused with a clear error — never silently substituted.
- **FR-009**: For viewer credentials, the license assignment list MUST return only the token owner's assignments regardless of supplied filter arguments; non-identity filters (tool name, status, limit) still apply within that scope.
- **FR-010**: For viewer credentials, the AI tool catalog MUST omit license utilization details (seat/assignment counts), mirroring the web UI's viewer view of the tools page.
- **FR-011**: Credentials whose resolved role is missing or unrecognized MUST be treated as viewer (least privilege), never as admin.
- **FR-012**: Tool denial messages MUST be consistent across all admin-only tools and informative enough for an AI assistant to relay the reason ("requires the admin role") to its end user.

### Key Entities

- **Hub user role**: existing per-user attribute (admin or viewer) on the user directory; the single source of truth for both web UI and MCP authorization.
- **MCP credential**: either a user-bound OAuth access token (carries the bound user's identity and live-resolved role) or the org-level shared secret (admin-equivalent, no bound user).
- **Tool access class**: each of the 14 MCP tools belongs to exactly one class — *admin-only* (11 tools), *personal/self-scoped* (user cost profile, license assignments), or *viewer-safe catalog* (AI tool list, with utilization stripped for viewers).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A viewer credential invoking each of the 11 admin-only tools receives an authorization error in 100% of attempts, with zero organizational data fields present in any response.
- **SC-002**: An admin credential invoking each of the 14 tools receives responses identical in shape and content to the pre-feature behaviour (verified by the existing tool test suite continuing to pass for admin context).
- **SC-003**: A viewer credential can retrieve their own cost profile and own license assignments on the first attempt without supplying any identity argument.
- **SC-004**: A viewer credential attempting to read another user's profile or assignments by email receives a refusal in 100% of attempts, including case-variant emails.
- **SC-005**: After a role demotion, the demoted user's existing token is refused admin-only tools on the very next invocation (no propagation delay beyond the in-flight request).
- **SC-006**: The shared-secret credential's behaviour on org-wide tools is unchanged from feature 038.

## Assumptions

- The Hub has exactly two roles (admin, viewer) today; the feature treats anything else as viewer rather than inventing a third class.
- Parity target is the current web UI: tools page is viewer-visible without utilization counts; users directory, Claude/Copilot/budget/invoice/sync surfaces are admin-only; profile-style data is self-only for viewers.
- Tool *listing* (discovery) remains identical for all credentials; only invocation is enforced. This matches the protocol mechanics already in place and is acceptable because tool names alone leak no organizational data.
- The shared secret is an org-level operational credential whose holders are by definition trusted at admin level (spec 034 judgment), so restricting it is out of scope here.
- No new persistent data is required; the existing user role attribute is the source of truth.
