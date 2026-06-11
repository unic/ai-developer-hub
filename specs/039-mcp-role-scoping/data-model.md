# Data Model: Role-Scoped MCP Tools

**Feature**: 039-mcp-role-scoping | **Date**: 2026-06-11

No database schema changes. This feature only adds in-memory types over existing data.

## Existing persistent entities (unchanged)

- **users.role** — `user_role` enum (`admin` | `viewer`), default `viewer`. Single source of truth for authorization in both the web UI and (after this feature) the MCP layer.
- **mcp_oauth_tokens.user_id** — binds every OAuth access token to one hub user. Role is *not* stored on the token; it is re-read from `users` at verification time (FR-002).

## New/extended in-memory types

### VerifiedAccessToken (extended — `src/lib/oauth/store.ts`)

| Field | Type | Notes |
|---|---|---|
| userId | number | existing |
| email | string | existing |
| name | string | existing |
| clientPublicId | string | existing |
| scope | string | existing |
| **role** | `"admin" \| "viewer"` | NEW — projected from the existing `users` join |

### AuthInfo.extra contract (produced by `verifyMcpToken`)

| Credential | extra |
|---|---|
| OAuth access token | `{ userId: number, email: string, name: string, role: "admin" \| "viewer" }` |
| Shared secret (`MCP_SERVER_SECRET`) | `{ role: "admin" }` — admin-equivalent, no bound identity |

### McpCaller (new — `src/lib/mcp/access.ts`)

| Field | Type | Notes |
|---|---|---|
| role | `McpRole` (`"admin" \| "viewer"`) | parsed from `AuthInfo.extra.role`; anything unrecognized → `"viewer"` (least privilege, FR-011) |
| userId | `number \| undefined` | absent for shared secret |
| email | `string \| undefined` | absent for shared secret; used for self-scoping |

## Tool access classes (derivation rules)

| Class | Tools (count) | Viewer behaviour | Admin / shared-secret behaviour |
|---|---|---|---|
| admin-only | 11 | `isError` denial, no data fetched | unchanged from 038 |
| self-scoped | get_user_cost_profile, list_license_assignments | identity pinned to token owner; foreign email → denial | any email; omitted email → own (OAuth) or validation error (shared secret, profile tool) |
| viewer-safe catalog | list_ai_tools | utilization fields omitted (`activeAssignments`, `maxLicenses`, `licenseUtilizationPct`), aggregate query skipped | full payload, unchanged |

## State transitions

Role change (`users.role` UPDATE via existing admin UI) → next `verifyAccessToken` call projects the new role → next tool invocation enforces it. No propagation machinery; the "transition" is just the live read (SC-005). Deactivation continues to kill verification entirely (`users.status = 'active'` filter, unchanged).
