import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isPublicPath } from "@/lib/routes";
import { isAgentDenied } from "@/lib/agent-auth";
import { logAgentRequest } from "@/lib/agent-log";

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (!req.auth && !isPublicPath(pathname)) {
    const callbackUrl = encodeURIComponent(pathname + search);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, req.url),
    );
  }

  if (req.auth?.user?.isAgent) {
    if (isAgentDenied(pathname, req.method)) {
      logAgentRequest({
        pathname,
        method: req.method,
        decision: "deny",
        status: 403,
        userId: req.auth.user.id,
        reason: "deny-list",
      });
      return new NextResponse("Forbidden (agent deny-list)", { status: 403 });
    }
    logAgentRequest({
      pathname,
      method: req.method,
      decision: "allow",
      userId: req.auth.user.id,
    });
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname + search);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/sync|api/invoices/ingest|api/license-requests/ingest|api/profile|api/agent/session|api/mcp).*)",
  ],
};
