import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import authConfig from "@/auth.config";
import { DEMO_READ_ONLY_MESSAGE, decideDemoRequest } from "@/lib/demo/demoAccess";

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
  /*
   * Scheduled jobs. Vercel Cron sends a plain GET with a `Bearer $CRON_SECRET` header and no
   * session cookie, so without this the session gate below answers 401 and the job never
   * reaches its route — every cron in the app was unreachable by construction. Each route
   * checks CRON_SECRET itself and 401s without it, so this exempts them from the SESSION gate
   * only, not from authentication.
   */
  if (pathname.startsWith("/api/cron/")) {
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
  // The landing page's static assets. NOT optional: the matcher at the bottom of this file only
  // exempts image extensions, so `support.js` and the walkthrough `.mp4` would be redirected to
  // /login for exactly the signed-out visitors the page exists for — it would boot to a blank
  // frame with no video. Images already bypass the matcher; this covers the rest.
  if (pathname.startsWith("/landing/")) {
    return NextResponse.next();
  }
  // The landing page. `/welcome` is rewritten to `public/landing/index.html` (next.config.mjs,
  // beforeFiles), so the bounce the old React page did in its own body has to happen here —
  // a static file can't read the session. Stale links and PWA-cached entries still land right.
  if (pathname === "/welcome") {
    if (req.auth) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }
  // Demo entry (the page redirects to /api/auth/demo, which is matcher-exempt).
  if (pathname === "/demo") {
    return NextResponse.next();
  }

  const authed = Boolean(req.auth);

  if (debugGate) {
    console.log("[middleware] pathname:", pathname, "authed:", authed);
  }

  // Demo mode is READ-ONLY (MONETISATION_NORTH_STAR.md Phase 3). One central chokepoint for
  // all ~111 mutating API routes; the tiny allowlist (Engineer chat) lives in demoAccess.ts.
  // Sits AFTER the public early-returns (checkout/join stay reachable — the conversion path)
  // and BEFORE proceed(). /api/auth/* is matcher-exempt: sign-out works, and the account
  // DELETE route carries its own in-route demo guard.
  const isDemo =
    req.auth?.user?.isDemo === true ||
    (Boolean(process.env.DEMO_USER_ID) && req.auth?.user?.id === process.env.DEMO_USER_ID);
  if (isDemo && decideDemoRequest({ method: req.method, pathname }) === "forbid") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE, demo: true }, { status: 403 });
    }
    // Server actions POST to page paths.
    return new NextResponse(DEMO_READ_ONLY_MESSAGE, { status: 403 });
  }

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // A stranger hitting the front door gets the pitch, not a sign-in form. Deep links keep
    // going to /login so an existing user's bookmark works after their session expires.
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/welcome", req.url));
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
