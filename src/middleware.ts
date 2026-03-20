import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isPublicPath } from "@/lib/routes";

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (!req.auth && !isPublicPath(pathname)) {
    const callbackUrl = encodeURIComponent(pathname + search);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, req.url)
    );
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname + search);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/copilot/sync|api/anthropic/sync).*)",
  ],
};
