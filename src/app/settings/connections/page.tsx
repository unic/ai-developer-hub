/**
 * Settings → Connections (038-mcp-v2): the signed-in user's active MCP OAuth
 * grants, with revocation. Available to every role — grants are personal.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { listGrantsForUser } from "@/lib/oauth/store";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RevokeConnectionButton } from "./revoke-button";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const grants = await listGrantsForUser(Number(session.user.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP Connections</CardTitle>
        <CardDescription>
          Apps you have authorized to read AI-spend data through the Hub&apos;s
          MCP server (e.g. Claude Desktop, Claude Code). Revoking a connection
          immediately invalidates its tokens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active connections. Add the Hub as a custom connector in Claude
            (Settings → Connectors) or run{" "}
            <code className="font-mono text-xs">
              claude mcp add --transport http ai-developer-hub &lt;hub-url&gt;/api/mcp/mcp
            </code>{" "}
            to create one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Authorized</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.tokenId}>
                  <TableCell className="font-medium">
                    {grant.clientName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {grant.scope}
                  </TableCell>
                  <TableCell>{formatDate(grant.createdAt)}</TableCell>
                  <TableCell>{formatDate(grant.lastUsedAt)}</TableCell>
                  <TableCell>{formatDate(grant.refreshExpiresAt)}</TableCell>
                  <TableCell className="text-right">
                    <RevokeConnectionButton
                      familyId={grant.familyId}
                      clientName={grant.clientName}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
