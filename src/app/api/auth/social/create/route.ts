import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { parseAuthOnlyEmails } from "@/lib/authAllowlist";
import { clientIpKey } from "@/lib/clientIp";
import { hasDatabaseUrl } from "@/lib/env";
import { mintMagicLinkPath } from "@/lib/auth/mintMagicLinkUrl";
import { clearPendingLink, readPendingLink } from "@/lib/auth/social/pendingLink";
import { LinkedElsewhereError, linkIdentity } from "@/lib/auth/social/resolveSocialSignIn";
import { providerLabel } from "@/lib/auth/social/socialSignInLogic";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import { prisma } from "@/lib/prisma";

/**
 * "I'm new" on `/login/connect`, inside the iPhone app: make the account for the Apple/Google
 * identity waiting in the pending cookie, link it, and sign it in. The account is UNPAID, exactly
 * like the app's email sign-up (`/api/auth/app-signup`, whose rules this follows): entitlement
 * keeps it on "You're signed up" until a plan exists.
 *
 * App only: the website's way in for someone new is paying first (/join), so there this is a 404.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isNativeShellRequest())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const rl = checkApiRateLimit({
    key: `social-create:${clientIpKey(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const pending = await readPendingLink();
  if (!pending?.email || !pending.emailVerified) {
    return NextResponse.json(
      { error: "That took too long. Please sign in again." },
      { status: 400 },
    );
  }
  const email = pending.email;

  // The beta shares production's database and is closed to everyone it doesn't list.
  const only = parseAuthOnlyEmails();
  if (only.size > 0 && !only.has(email)) {
    return NextResponse.json({ error: "Sign-ups aren't open here." }, { status: 403 });
  }

  let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    try {
      user = await prisma.user.create({
        data: { email, name: pending.name, image: pending.image, emailVerified: new Date() },
        select: { id: true },
      });
    } catch (err) {
      // Two taps racing on one address: the other request made the account, which is the same end.
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicate) throw err;
      user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    }
  }
  if (!user) {
    return NextResponse.json({ error: "Please try again." }, { status: 500 });
  }

  try {
    await linkIdentity(user.id, pending, {
      refreshToken: pending.appleRefreshToken,
      clientId: pending.appleClientId,
    });
  } catch (err) {
    if (!(err instanceof LinkedElsewhereError)) throw err;
    await clearPendingLink();
    return NextResponse.json(
      {
        error: `That ${providerLabel(pending.provider)} account is already connected to a different Trackside account.`,
      },
      { status: 409 },
    );
  }
  await clearPendingLink();
  return NextResponse.json({ next: await mintMagicLinkPath(email, "/") });
}
