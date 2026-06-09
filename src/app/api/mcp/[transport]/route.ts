/**
 * MCP server endpoint (Model Context Protocol over Streamable HTTP).
 *
 * Mounts the Hub's read-only tools at `/api/mcp/mcp`. Auth is the shared
 * `MCP_SERVER_SECRET` bearer token enforced by `withMcpAuth`; when the secret
 * is unset the server rejects every request (see src/lib/mcp/auth.ts).
 *
 * This route is excluded from the NextAuth middleware matcher so unauthenticated
 * clients receive a clean 401 instead of a redirect to /login.
 */

import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { registerHubTools } from "@/lib/mcp/tools";
import { verifyMcpToken } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerHubTools(server);
  },
  {},
  { basePath: "/api/mcp" },
);

const authHandler = withMcpAuth(handler, verifyMcpToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
