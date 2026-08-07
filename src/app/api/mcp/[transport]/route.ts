/**
 * MCP server endpoint (Model Context Protocol over Streamable HTTP).
 *
 * Mounts the Hub's read-only tools at `/api/mcp/mcp`. Auth accepts either the
 * shared `MCP_SERVER_SECRET` bearer token (headless clients) or an OAuth
 * access token issued by the embedded authorization server (Claude Desktop /
 * claude.ai / Claude Code connectors) — see src/lib/mcp/auth.ts and
 * src/lib/oauth/*. Unauthenticated requests get a 401 whose WWW-Authenticate
 * header points clients at /.well-known/oauth-protected-resource to start the
 * OAuth flow.
 *
 * This route is excluded from the NextAuth middleware matcher so unauthenticated
 * clients receive a clean 401 instead of a redirect to /login.
 */

import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { registerHubTools } from "@/lib/mcp/tools";
import { registerHubWriteTools } from "@/lib/mcp/write";
import { verifyMcpToken } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerHubTools(server);
    // Registered unconditionally so their descriptions explain the requirement
    // rather than the tools vanishing; each one refuses at call time unless
    // MCP_WRITE_ENABLED=1 and the credential is an admin holding mcp:write.
    registerHubWriteTools(server);
  },
  {},
  { basePath: "/api/mcp" },
);

const authHandler = withMcpAuth(handler, verifyMcpToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
