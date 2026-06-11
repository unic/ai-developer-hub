# MCP Server

The AI Developer Hub exposes a read-only [Model Context Protocol](https://modelcontextprotocol.io)
server so MCP clients (Claude Desktop / claude.ai / Claude Code, Cursor, etc.)
can query live AI-spend data in natural language.

- **Endpoint:** `POST /api/mcp/mcp` (Streamable HTTP transport)
- **Auth:** OAuth 2.1 (per-user grants, used by Claude connectors) **or**
  `Authorization: Bearer <MCP_SERVER_SECRET>` (shared secret for headless clients)
- **Access:** read-only. No mutations, no decrypted API keys, no password hashes.

## Connecting from Claude (OAuth)

The Hub embeds a minimal OAuth 2.1 authorization server (spec 038), so Claude
clients connect with zero pre-provisioning — they self-register via Dynamic
Client Registration and each user signs in with their normal Hub account.

- **Claude Desktop / claude.ai / mobile:** Settings → Connectors → *Add custom
  connector* → URL `https://<your-hub-host>/api/mcp/mcp`. Claude opens the
  Hub's consent screen in a browser; sign in and click **Allow**.
- **Claude Code:**

  ```bash
  claude mcp add --transport http ai-developer-hub https://<your-hub-host>/api/mcp/mcp
  # then inside Claude Code: /mcp → authenticate
  ```

Every grant is bound to the Hub user who consented: access tokens expire after
1 hour (clients refresh automatically; refresh tokens rotate and last 60 days),
deactivating the user kills their tokens, and users can revoke a connection
anytime under **Settings → Connections**.

OAuth plumbing (all served by the app itself):

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource[/api/mcp/mcp]` | RFC 9728 resource metadata (points at the Hub as authorization server) |
| `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata (S256-only PKCE, public clients) |
| `POST /api/oauth/register` | RFC 7591 dynamic client registration (rate-limited) |
| `GET /oauth/authorize` | Consent screen behind the normal Hub login |
| `POST /api/oauth/token` | Code + PKCE exchange, rotating refresh tokens |

> Vercel preview deployments with protection enabled block the unauthenticated
> metadata probes, so OAuth connects are for production (or unprotected
> previews) — the same constraint as the profile API.

## Shared secret (headless clients)

1. Generate a secret (min 16 chars) and set it in the environment:

   ```bash
   MCP_SERVER_SECRET="$(openssl rand -base64 32)"
   ```

2. Configure the client with a static header:

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

When `MCP_SERVER_SECRET` is unset the shared-secret path is dormant (one-time
warning in the logs); OAuth tokens keep working independently.

Test locally with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# point it at http://localhost:3000/api/mcp/mcp — it will walk the OAuth flow,
# or set the bearer header to use the shared secret.
```

## Tools

All monetary fields are returned as both integer cents (`*Cents`) and a derived
USD number (`*Usd`). Every tool carries `annotations.readOnlyHint = true`.

| Tool | Input | Description |
| --- | --- | --- |
| `list_ai_tools` | – | Active AI tools with access tiers, monthly cost, active license counts, and license utilization. |
| `find_users` | `query`, `limit?` | Search users by partial name/email — resolve a person before user-keyed calls. |
| `get_user_cost_profile` | `email`, `month?` (YYYY-MM) | A user's active licenses and Claude API cost breakdown for a month (exact email; suggests near-matches on miss). |
| `get_claude_spend_summary` | `month?` (YYYY-MM) | Org-wide Claude spend KPIs: MTD total, MoM delta, month-end projection, workspaces over 80% of cap, today's estimate. |
| `list_claude_users` | `month?`, `limit?` | Per-user Claude spend for a month, ordered by cost: totals, tokens, models, last active. |
| `get_claude_cost_dashboard` | `month?` | Daily spend series, per-workspace totals with MoM deltas, 12-month history. |
| `list_claude_workspaces` | – | Anthropic workspaces with current-month spend, cap, utilization %, and today's estimate. |
| `get_budget_status` | `fiscalYear?` | Annual budget: per-period planned/billed/expected/actual and an OLS forecast with on-track / at-risk verdict. |
| `get_budget_report` | – | Detailed budget report: per-period actuals incl. running API costs, per-tool YTD + EoY projection, last period's variance drivers. |
| `list_license_assignments` | `email?`, `toolName?`, `status?`, `limit?` | The license register: who holds which license at what monthly cost. |
| `list_invoices` | `month?`, `vendor?`, `linked?`, `limit?` | Uploaded invoices with amounts and budget-period link status. |
| `get_copilot_usage_summary` | `since?`, `until?` (YYYY-MM-DD) | GitHub Copilot seat/billing snapshot and aggregated usage over a range. |
| `get_copilot_analytics` | `since?`, `until?` (YYYY-MM-DD) | Daily Copilot usage series plus top languages and editors. |
| `list_recent_sync_events` | `sourceType?`, `limit?` | Recent data-pipeline sync events plus Claude-spend data freshness. |

## Architecture

- `src/app/api/mcp/[transport]/route.ts` — mounts the server via `mcp-handler`
  (`createMcpHandler` + `withMcpAuth`). Thin by design.
- `src/lib/mcp/auth.ts` — `verifyMcpToken`: shared secret (constant-time
  compare) or OAuth access token lookup.
- `src/lib/mcp/tools.ts` — registers the tools (Zod input schemas).
- `src/lib/mcp/data.ts` — data assembly; delegates to the existing tested read
  layer (`profile-data`, `anthropic/queries`, `actions/budget`, ...) or runs
  focused read-only queries.
- `src/lib/mcp/format.ts` — pure helpers (`centsToUsd`, `usd`, result wrappers).
- `src/lib/oauth/` — embedded authorization server: `validate.ts` (redirect
  URI policy, PKCE, DCR schema), `metadata.ts` (discovery docs), `store.ts`
  (clients/codes/tokens, SHA-256-hashed at rest, rotating refresh tokens with
  family-revocation reuse detection), `authorize.ts` (authorize-request
  validation shared by page + consent actions).

The MCP route, `/api/oauth/*`, and `/.well-known/*` are excluded from the
NextAuth middleware matcher; `/oauth/authorize` deliberately stays behind it so
anonymous visitors are sent to `/login` and back.

## Security notes

- Read-only: there are no write/mutation tools.
- `get_user_cost_profile` returns only the same surface as the existing
  `/api/profile` route — never decrypted API keys.
- OAuth tokens are stored as SHA-256 hashes only; access tokens live 1 h,
  refresh tokens rotate (replaying a rotated token revokes its whole family).
- Token verification joins `users.status = 'active'`, so deactivating a user
  revokes their MCP access immediately.
- Redirect URIs: exact match, https-only except loopback `http` (port ignored
  per RFC 8252 §7.3). Registration and token endpoints are rate-limited.
