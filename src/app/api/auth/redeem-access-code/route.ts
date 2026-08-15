import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import {
  isSignupAccessCodeConfigured,
  verifySignupAccessCode,
} from "@/lib/auth/signupAccessCode";

/**
 * Self-serve signup: a valid shared access code adds the email to `AuthAllowedEmail`, after which
 * the normal magic-link / Google flow in `src/auth.ts` runs unchanged. Nothing about the auth
 * config itself opens up — the allowlist stays the single source of truth.
 *
 * Public by construction: the middleware matcher excludes `api/auth` entirely, and this static
 * segment takes priority over the `[...nextauth]` catch-all.
 */

function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || !t.includes("@") || /\s/.test(t)) return null;
  return t;
}


export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Best-effort only — it's per serverless instance, so code entropy is the real defence.
  const rl = checkApiRateLimit({
    key: `redeem-access-code:${clientIpKey(request)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as
    | { email?: string; code?: string }
    | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  // Per-email brake. In open-signup mode this preflight is the only thing between a script and a
  // flood of magic-link sends to one address, so limit by email as well as IP: an IP rotating
  // addresses is caught above; a botnet hammering one address is caught here. Same per-instance
  // caveat as the IP limit — real defence is code entropy (invite mode) or a captcha (open mode).
  const emailRl = checkApiRateLimit({
    key: `redeem-access-code:email:${email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!emailRl.ok) return rateLimitResponse(emailRl.retryAfterSec);

  const codeValid = isSignupAccessCodeConfigured() && verifySignupAccessCode(body?.code);

  // A valid code always writes the row, even for an address that already passes the allowlist.
  // In dev `AUTH_DEV_ALLOW_ANY_EMAIL=1` makes `isEmailAuthAllowed` true for everything, so an
  // early return would leave NO row — redemption would look like it worked while the durable
  // grant never happened, and the account would stop working the moment the flag is turned off.
  if (codeValid) {
    await prisma.authAllowedEmail.upsert({
      where: { email },
      create: { email },
      update: {},
      select: { id: true },
    });
    return NextResponse.json({ ok: true, redeemed: true });
  }

  // No code, but already allowlisted (founder-invited or env list) — let them straight through.
  // Returning ok here is a mild membership oracle for someone holding no valid code; the trade is
  // deliberate. Otherwise a stranger who typo'd the code waits forever on /login/verify-request
  // for an email `sendVerificationRequest` silently declined to send.
  if (await isEmailAuthAllowed(email)) {
    return NextResponse.json({ ok: true, redeemed: false });
  }

  // Nothing was offered and the address isn't known — the ordinary stranger who just typed their
  // email in. Since 2026-08-15 the code field is gone from the form (it rides in the URL instead),
  // so telling this person their code is wrong would point at a box that no longer exists.
  // `needsAccount` lets the form send them to the paid door instead.
  const suppliedCode = typeof body?.code === "string" ? body.code.trim() : "";
  if (!suppliedCode || !isSignupAccessCodeConfigured()) {
    return NextResponse.json(
      { ok: false, needsAccount: true, error: "That email doesn't have an account yet." },
      { status: 403 }
    );
  }

  // A code WAS offered and didn't match — they followed an invite link that's wrong or revoked,
  // and that is worth saying plainly rather than hiding behind the generic message above.
  return NextResponse.json(
    { ok: false, error: "That invite link isn't valid any more. Ask for a new one." },
    { status: 403 }
  );
}
