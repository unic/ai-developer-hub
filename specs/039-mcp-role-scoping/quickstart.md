# Quickstart: Role-Scoped MCP Tools

**Feature**: 039-mcp-role-scoping

## Run the unit tests (no DB needed)

```bash
pnpm test tests/unit/mcp
```

`access.test.ts` covers the pure role/self-scope helpers; `tools.test.ts` covers the per-tool admin/viewer/shared-secret matrix with the data layer mocked.

## Exercise it end-to-end locally

1. Start the dev server (worktree convention: copy the main repo's `.env.local`, run on a free port):

   ```bash
   pnpm dev -p 3001
   ```

2. Get tokens for two users — easiest via the shared secret plus a viewer OAuth token:
   - **Shared secret** (admin-equivalent): `MCP_SERVER_SECRET` from `.env.local`.
   - **Viewer token**: log into the Hub as a viewer-role user and complete the MCP OAuth flow from an MCP client (Claude Code: `claude mcp add --transport http hub http://localhost:3001/api/mcp/mcp`), or mint one through the authorize/token endpoints with PKCE.

3. Probe with raw JSON-RPC (replace `$TOKEN`):

   ```bash
   curl -s http://localhost:3001/api/mcp/mcp \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_budget_status","arguments":{}}}'
   ```

   Expected: full budget JSON with the shared secret / an admin token; an `isError` result with the admin-required message with a viewer token.

4. Self-scoping check (viewer token):

   ```bash
   # Own profile, no email argument → succeeds
   ... -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_user_cost_profile","arguments":{}}}'
   # Someone else's email → refusal
   ... -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_user_cost_profile","arguments":{"email":"someone.else@unic.com"}}}'
   ```

5. Live demotion check: flip the user's role in the DB (`UPDATE users SET role='viewer' WHERE email='...'`), repeat step 3 with their existing token — the very next call is refused.

## What to look for

- Viewer denials are tool results (`isError: true`), not HTTP 401/403 — the MCP session stays healthy.
- `list_ai_tools` as viewer: no `activeAssignments`, `maxLicenses`, or `licenseUtilizationPct` keys.
- Admin responses are byte-identical to feature 038 behaviour.
