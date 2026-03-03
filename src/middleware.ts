import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const response = NextResponse.next();
  response.headers.set("x-pathname", req.nextUrl.pathname);
  return response;
});
