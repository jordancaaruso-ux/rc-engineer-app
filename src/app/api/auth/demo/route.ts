import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";

/**
 * Demo sign-in (MONETISATION_NORTH_STAR.md Phase 3): signs any visitor into the shared
 * read-only demo account. Public by construction — the middleware matcher excludes
 * `api/auth` entirely, and this static segment takes priority over the `[...nextauth]`
 * catch-all (same trick as redeem-access-code).
 *
 * Reuses the magic-link scheme end-to-end (mint a single-use VerificationToken, redirect to
 * Auth.js's own callback) so no Auth.js internals are hand-rolled: the callback consumes the
 * token, the adapter finds the existing demo User, and Auth.js issues the JWT cookie itself.
 * The `signIn` gate passes because the seed writes an AuthAllowedEmail row for the demo email
 * (safe — grandfathering is admins-only), and entitlement resolves Pro from the seeded fake
 * Subscription row.
 *
 * 503s until the demo user actually exists, so a pre-seed deploy can never let the Auth.js
 * adapter mint an EMPTY demo account on first click.
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const demoId = process.env.DEMO_USER_ID?.trim();
  const demoEmail = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!demoId || !demoEmail || !secret) {
    return NextResponse.json({ error: "The demo isn't ready yet." }, { status: 503 });
  }

  const rl = checkApiRateLimit({
    key: `demo-signin:${clientIpKey(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const demoUser = await prisma.user.findUnique({
    where: { id: demoId },
    select: { id: true },
  });
  if (!demoUser) {
    return NextResponse.json({ error: "The demo isn't ready yet." }, { status: 503 });
  }

  // Belt-and-braces beside the seed: the signIn callback rejects non-allowlisted emails.
  await prisma.authAllowedEmail.upsert({
    where: { email: demoEmail },
    create: { email: demoEmail },
    update: {},
    select: { id: true },
  });

  // Same token scheme as scripts/dev-fresh-onboarding.ts — if the callback ever rejects
  // these links, @auth/core's hash input or provider id changed; fix both together.
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: demoEmail,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      // Consumed within seconds by the redirect below — keep the window tight.
      expires: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const origin =
    (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? new URL(request.url).origin)
      .trim()
      .replace(/\/$/, "");
  // Demo drops into Analysis first (decision-board pick 7C) — graphs before anything else.
  const params = new URLSearchParams({
    callbackUrl: `${origin}/analysis`,
    token,
    email: demoEmail,
  });
  return NextResponse.redirect(`${origin}/api/auth/callback/nodemailer?${params}`);
}
