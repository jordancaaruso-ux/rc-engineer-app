import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

let accessPasswordWarned = false;

/** Set DEBUG_ACCESS_GATE=1 in .env.local to log pathname, gate presence, cookie, redirect (dev debugging). */
const debugGate = process.env.DEBUG_ACCESS_GATE === "1";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const password = process.env.ACCESS_PASSWORD?.trim();
  const auth = request.cookies.get("rc-auth")?.value;

  if (debugGate) {
    const masked = password ? `[set len=${password.length}]` : "missing";
    console.log("[middleware] pathname:", pathname);
    console.log("[middleware] ACCESS_PASSWORD:", password ? "present" : "missing/empty", masked);
    console.log("[middleware] rc-auth cookie:", auth ? `[set len=${auth.length}]` : "missing");
  }

  if (!password) {
    if (!accessPasswordWarned) {
      accessPasswordWarned = true;
      console.warn(
        "[middleware] ACCESS_PASSWORD is not set — app password gate is disabled (OK for local dev)."
      );
    }
    return NextResponse.next();
  }

  if (auth !== password) {
    if (debugGate) {
      console.log("[middleware] redirect → /login (cookie mismatch or missing)");
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (debugGate) {
    console.log("[middleware] allow (cookie matches ACCESS_PASSWORD)");
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Include "/" explicitly: patterns like "/((?!_next/static|_next/image).*)" often do NOT match
     * the bare root path in Next.js, so middleware never ran for "/" and the gate looked "off".
     */
    "/",
    "/((?!_next/static|_next/image).*)",
  ],
};
