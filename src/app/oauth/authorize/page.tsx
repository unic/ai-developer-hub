/**
 * OAuth 2.1 authorization (consent) page for the embedded MCP authorization
 * server (038-mcp-v2).
 *
 * Sits behind the normal NextAuth login (the middleware redirects anonymous
 * visitors to /login with a callbackUrl pointing back here), renders without
 * the app sidebar (see isBareLayoutPath), and re-validates everything in the
 * server actions on submit.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { approveAuthorization, denyAuthorization } from "@/actions/oauth";
import {
  readAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorize";
import { MCP_SCOPE } from "@/lib/oauth/validate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorization error</CardTitle>
          <CardDescription>
            This authorization request cannot be completed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = readAuthorizeParams((key) => first(raw[key]));

  const session = await auth();
  if (!session?.user) {
    // Middleware normally handles this; kept as defense in depth.
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [
        string,
        string,
      ][],
    );
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }
  if (session.user.isAgent) {
    return <ErrorCard message="Agent accounts cannot authorize MCP clients." />;
  }

  const validation = await validateAuthorizeRequest(params);
  if (!validation.ok) {
    if (validation.fatal) return <ErrorCard message={validation.message} />;
    redirect(validation.redirectTo);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorize {validation.client.clientName}</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">
              {validation.client.clientName}
            </span>{" "}
            wants to connect to the AI Developer Hub MCP server as{" "}
            <span className="font-medium text-foreground">
              {session.user.email}
            </span>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">This grants:</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              Read-only access to AI spend data — tools, budgets, Claude and
              Copilot usage (<code className="font-mono text-xs">{MCP_SCOPE}</code>)
            </li>
          </ul>
          <p className="text-muted-foreground">
            No write access. You can revoke this anytime under Settings →
            Connections.
          </p>
        </CardContent>
        <CardFooter>
          <form action={approveAuthorization} className="flex w-full gap-3">
            {Object.entries(params).map(([key, value]) =>
              value !== undefined ? (
                <input key={key} type="hidden" name={key} value={value} />
              ) : null,
            )}
            <Button
              type="submit"
              formAction={denyAuthorization}
              variant="outline"
              className="flex-1"
            >
              Deny
            </Button>
            <Button type="submit" className="flex-1">
              Allow
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
