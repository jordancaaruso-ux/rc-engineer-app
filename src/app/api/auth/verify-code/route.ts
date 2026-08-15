import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { consumeSignInCode } from "@/lib/auth/signInCode";
import { normalizeCodeInput } from "@/lib/auth/signInCodeShared";
import { mintMagicLinkPath } from "@/lib/auth/mintMagicLinkUrl";

/**
 * Exchange the code from the sign-in email for a session in THIS browser.
 *
 * The problem it solves: a magic link lands wherever the OS chooses to open it. Ask for one in
 * Safari on an iPhone and Mail hands it to the default browser, which collects the session cookie
 * and leaves the tab you were looking at with nothing — cookie jars don't leak between browsers,
 * and the link is single-use so it can't be retried. Typing the code back into the original tab
 * is the only credential that crosses that gap.
 *
 * How it signs you in: on a correct code this mints a fresh Auth.js verification token and hands
 * back the ordinary `/api/auth/callback/nodemailer` path. The browser navigates there and Auth.js
 * does everything it normally does — consumes the token, re-runs the allowlist `signIn` callback,
 * sets the cookie. Nothing here forges a session; the one helper that does (`devSessionCookie.ts`)
 * throws in production and stays fenced off.
 *
 * Public by construction, same as `redeem-access-code`: the middleware matcher excludes `api/auth`
 * entirely, and this static segment takes priority over the `[...nextauth]` catch-all.
 */

/** One message for every failure. Distinguishing them would leak who has a sign-in in flight. */
const GENERIC_FAILURE = "That code isn't right, or it has expired. Request a new one.";

function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || !t.includes("@") || /\s/.test(t)) return null;
  return t;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Two brakes, same shape as `redeem-access-code`: an IP rotating addresses is caught here, a
  // botnet hammering one address is caught below. Both are per-serverless-instance and therefore
  // only brakes — the guess limit that actually holds is the `attempts` column on the row.
  const rl = checkApiRateLimit({
    key: `verify-code:${clientIpKey(request)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as
    | { email?: string; code?: string; callbackUrl?: string }
    | null;

  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  const code = normalizeCodeInput(typeof body?.code === "string" ? body.code : null);
  if (!email || !code) {
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 400 });
  }

  const emailRl = checkApiRateLimit({
    key: `verify-code:email:${email}`,
    limit: 15,
    windowMs: 60 * 60 * 1000,
  });
  if (!emailRl.ok) return rateLimitResponse(emailRl.retryAfterSec);

  const accepted = await consumeSignInCode(email, code);
  if (!accepted) {
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }

  // Belt on top of braces. The code was only ever issued after this same check in
  // `sendVerificationRequest`, and the `signIn` callback checks again on the callback hop — but a
  // grant revoked while a code was in flight should die here, not one redirect later.
  if (!(await isEmailAuthAllowed(email))) {
    return NextResponse.json({ ok: false, error: GENERIC_FAILURE }, { status: 401 });
  }

  // Relative, so it resolves against the origin the browser is already on rather than AUTH_URL.
  const rawCallback = typeof body?.callbackUrl === "string" ? body.callbackUrl : "/";
  const callbackPath = rawCallback.startsWith("/") && !rawCallback.startsWith("//")
    ? rawCallback
    : "/";

  return NextResponse.json({ ok: true, url: await mintMagicLinkPath(email, callbackPath) });
}
