# Contract: MCP Tool Authorization Matrix

**Feature**: 039-mcp-role-scoping | **Date**: 2026-06-11

The externally observable contract of the MCP endpoint (`/api/mcp/[transport]`) per credential role. "Denied" means a tool-level result with `isError: true` and the shared admin-required message — never a protocol error, never partial data.

## Access matrix

| Tool | Admin token | Viewer token | Shared secret |
|---|---|---|---|
| list_ai_tools | full payload (incl. utilization) | payload **without** `activeAssignments`/`maxLicenses`/`licenseUtilizationPct` | full payload |
| get_user_cost_profile | any email; omitted → own | own profile only; omitted → own; foreign email → denied | any email; omitted → validation error (no bound identity) |
| list_license_assignments | any filters | pinned to own email; foreign email → denied; other filters apply within self-scope | any filters |
| get_claude_spend_summary | OK | **denied** | OK |
| list_claude_workspaces | OK | **denied** | OK |
| list_claude_users | OK | **denied** | OK |
| get_claude_cost_dashboard | OK | **denied** | OK |
| get_budget_status | OK | **denied** | OK |
| get_budget_report | OK | **denied** | OK |
| get_copilot_usage_summary | OK | **denied** | OK |
| get_copilot_analytics | OK | **denied** | OK |
| list_invoices | OK | **denied** | OK |
| list_recent_sync_events | OK | **denied** | OK |
| find_users | OK | **denied** | OK |

## Denial result shape (admin-only tools, viewer caller)

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: This tool requires the admin role. Your MCP credential is bound to a viewer account — viewers can use get_user_cost_profile and list_license_assignments (scoped to their own data) and list_ai_tools."
    }
  ],
  "isError": true
}
```

Invariants:

- The message is identical across all 11 admin-only tools (FR-012).
- No organizational data, counts, or names appear in any denial (FR-006).
- The wrapped data function is **not invoked** on denial (verified by unit tests).

## Self-scope refusal shape (personal tools, viewer caller, foreign email)

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error: Viewers can only access their own data. Omit the email argument (or pass your own email) to query the account bound to this token."
    }
  ],
  "isError": true
}
```

## Input schema changes

- `get_user_cost_profile.email`: **required → optional** (`z.string().email().optional()`). Omitted = token owner. This is backward compatible for all existing callers (passing an email still works for admins / own email for viewers).
- All other tool input schemas unchanged.
- Descriptions of the 11 admin-only tools gain the suffix "Requires an admin-role token." (discovery-time hint; enforcement stays at invocation).

## Tool discovery

`tools/list` returns the same 14 tools for every authenticated credential. Authorization is enforced at `tools/call` only.

## Role resolution timing

The enforcing role is read from `users.role` inside `verifyAccessToken` on the request being served. A role UPDATE committed before a request reaches token verification is reflected in that request's authorization decision (SC-005).
