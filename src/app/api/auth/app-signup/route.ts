import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { parseAuthOnlyEmails } from "@/lib/authAllowlist";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import { normalizeSignupEmail } from "@/lib/billing/paidSignupLogic";

/**
 * Sign-up inside the iPhone/Android app (2026-09-24). On the website the only way in is paying
 * first (/join). The app may neither sell a plan nor point at the website to buy one (App Store
 * guideline 3.1.3), so someone who found the app first creates their account here instead: an
 * UNPAID account with nothing unlocked, which the ordinary email-code sign-in then opens. Until a
 * plan exists, entitlement keeps them on the "You're signed up" screen (`/login/signed-up`), and
 * the welcome email sent from there carries the plans — outside the app, which 3.1.3 allows.
 *
 * App only: without the shell's user agent this is a 404, so the website never makes a free
 * account. A forged user agent buys a locked, empty account and nothing else.
 *
 * Never writes an `AuthAllowedEmail` row, which would read as an invite; `isEmailAuthAllowed`
 * lets any existing account sign in. Public by construction: the middleware matcher excludes
 * `api/auth` entirely.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isNativeShellRequest())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Best-effort, per serverless instance — same caveat as redeem-access-code, which the form
  // calls next and which also brakes per address.
  const rl = checkApiRateLimit({
    key: `app-signup:${clientIpKey(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeSignupEmail(body.email) : null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  // The beta shares production's database and is closed to everyone it doesn't list.
  const only = parseAuthOnlyEmails();
  if (only.size > 0 && !only.has(email)) {
    return NextResponse.json({ ok: false, error: "Sign-ups aren't open here." }, { status: 403 });
  }

  // Signing up with an address that already has an account just signs its owner in.
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ ok: true, created: false });

  try {
    await prisma.user.create({ data: { email }, select: { id: true } });
  } catch (err) {
    // Two taps racing on one address: the other request made the account, which is the same end.
    const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!duplicate) throw err;
  }
  return NextResponse.json({ ok: true, created: true });
}
