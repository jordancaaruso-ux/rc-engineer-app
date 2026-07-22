import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

/** Set DEBUG_ACCESS_GATE=1 to log auth middleware decisions (dev). */
const debugGate = process.env.DEBUG_ACCESS_GATE === "1";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next();
  }
  // Legal pages must be readable before sign-in — /login links to both.
  if (pathname === "/privacy" || pathname === "/terms") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/health/")) {
    return NextResponse.next();
  }
  // Build identity (env / branch / commit). Public because it exists to answer "which deployment
  // am I actually on?", a question that usually comes up because auth sent you somewhere
  // unexpected — gating it behind the very thing in doubt makes it useless. No secrets emitted.
  if (pathname === "/api/_debug/version") {
    return NextResponse.next();
  }

  const authed = Boolean(req.auth);

  if (debugGate) {
    console.log("[middleware] pathname:", pathname, "authed:", authed);
  }

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/",
    // Exclude /api/auth so Auth.js route handlers (session, callbacks) return JSON — not page 404 HTML.
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
