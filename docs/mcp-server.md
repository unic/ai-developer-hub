# MCP Server

The AI Developer Hub exposes a read-only [Model Context Protocol](https://modelcontextprotocol.io)
server so MCP clients (Claude Desktop / Code, Cursor, etc.) can query live
AI-spend data in natural language.

- **Endpoint:** `POST /api/mcp/mcp` (Streamable HTTP transport)
- **Auth:** `Authorization: Bearer <MCP_SERVER_SECRET>`
- **Access:** read-only. No mutations, no decrypted API keys, no password hashes.

## Setup

1. Generate a secret (min 16 chars) and set it in the environment:

   ```bash
   MCP_SERVER_SECRET="$(openssl rand -base64 32)"
   ```

2. Deploy. The server is **dormant by default**: when `MCP_SERVER_SECRET` is
   unset, every request is rejected with `401` and a one-time warning is logged,
   so the feature stays off until a secret is provisioned.

## Client configuration

```jsonc
{
  "mcpServers": {
    "ai-developer-hub": {
      "type": "http",
      "url": "https://<your-hub-host>/api/mcp/mcp",
      "headers": { "Authorization": "Bearer <MCP_SERVER_SECRET>" }
    }
  }
}
```

Test locally with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# then point it at http://localhost:3000/api/mcp/mcp with the bearer header
```

## Tools

All monetary fields are returned as both integer cents (`*Cents`) and a derived
USD number (`*Usd`).

| Tool | Input | Description |
| --- | --- | --- |
| `list_ai_tools` | – | Active AI tools and their access tiers with monthly cost. |
| `get_user_cost_profile` | `email`, `month?` (YYYY-MM) | A user's active licenses and Claude API cost breakdown for a month. Looked up by exact email. |
| `get_claude_spend_summary` | `month?` (YYYY-MM) | Org-wide Claude spend KPIs: MTD total, MoM delta, month-end projection, workspaces over 80% of cap, today's estimate. Defaults to current month. |
| `list_claude_workspaces` | – | Anthropic workspaces with current-month spend, cap, utilization %, and today's estimate. |
| `get_budget_status` | `fiscalYear?` | Annual budget: per-period planned/billed/expected/actual and an OLS forecast with on-track / at-risk verdict. Defaults to the active budget. |
| `get_copilot_usage_summary` | `since?`, `until?` (YYYY-MM-DD) | GitHub Copilot seat/billing snapshot and aggregated usage over a range. Defaults to the last 28 days. |
| `list_recent_sync_events` | `sourceType?`, `limit?` | Recent data-pipeline sync events plus Claude-spend data freshness. |

## Architecture

- `src/app/api/mcp/[transport]/route.ts` — mounts the server via `mcp-handler`
  (`createMcpHandler` + `withMcpAuth`). Thin by design.
- `src/lib/mcp/auth.ts` — shared-secret `verifyMcpToken` (constant-time compare).
- `src/lib/mcp/tools.ts` — registers the tools (Zod input schemas).
- `src/lib/mcp/data.ts` — data assembly; delegates to the existing tested read
  layer (`profile-data`, `anthropic/queries`, `actions/budget`, ...).
- `src/lib/mcp/format.ts` — pure helpers (`centsToUsd`, `usd`, result wrappers).

The route is excluded from the NextAuth middleware matcher (so unauthenticated
clients get a clean `401` instead of a redirect to `/login`) and added to the
nighthawk agent deny-list as defense-in-depth, mirroring `/api/sync`.

## Security notes

- Read-only: there are no write/mutation tools.
- `get_user_cost_profile` returns only the same surface as the existing
  `/api/profile` route — never decrypted API keys.
- The shared-secret model matches the Hub's other machine-to-machine endpoints
  (`PROFILE_API_SECRET`, `CRON_SECRET`). OAuth 2.1 is the documented upgrade
  path; `withMcpAuth` keeps that door open without reworking the tools.
