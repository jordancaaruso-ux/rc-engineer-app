import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

/** Set DEBUG_ACCESS_GATE=1 to log auth middleware decisions (dev). */
const debugGate = process.env.DEBUG_ACCESS_GATE === "1";

/** Mirrors PERF_ENABLED — this file runs on edge, so it cannot import the node-only config. */
const perfEnabled = process.env.PERF_INSTRUMENTATION === "1";

/**
 * Continue the request, stamping the path and method onto its headers so the Node
 * runtime can identify its own route. App Router exposes no reliable built-in for
 * this: `x-matched-path` is Vercel-only and `x-invoke-path` is dev-only.
 */
function proceed(req: NextRequest): NextResponse {
  if (!perfEnabled) return NextResponse.next();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-rc-perf-path", req.nextUrl.pathname);
  requestHeaders.set("x-rc-perf-method", req.method);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

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
  // Stripe webhooks are server-to-server and unauthenticated — the route verifies the signature.
  if (pathname === "/api/stripe/webhook") {
    return NextResponse.next();
  }
  // The paid door: /join (pricing) + /join/success (post-checkout landing) are how strangers pay
  // their way in, and the checkout API they call is public by design (rate-limited in the route).
  if (pathname === "/join" || pathname.startsWith("/join/")) {
    return NextResponse.next();
  }
  if (pathname === "/api/billing/public-checkout") {
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

  return proceed(req);
});

export const config = {
  matcher: [
    "/",
    // Exclude /api/auth so Auth.js route handlers (session, callbacks) return JSON — not page 404 HTML.
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
