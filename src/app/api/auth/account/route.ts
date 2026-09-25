import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { collectUserBlobUrls, deleteBlobUrls } from "@/lib/account/deleteAccountBlobs";
import { DEMO_READ_ONLY_MESSAGE, isDemoIdentity } from "@/lib/demo/demoAccess";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { revokeAppleToken } from "@/lib/auth/social/appleTokens";
import { appleAppClientId } from "@/lib/auth/social/socialConfig";

/** Stripe statuses with nothing left to cancel. */
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * GDPR / App Store: delete the signed-in user and all owned data (DB cascades), plus the files
 * they uploaded. Client should call `signOut({ callbackUrl: "/login" })` after a successful
 * response.
 */
export async function DELETE() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // /api/auth/* is excluded from the middleware matcher, so the central demo read-only guard
  // never sees this route — and this is the one click that would destroy the whole curated
  // demo dataset. Guard it explicitly (MONETISATION_NORTH_STAR.md Phase 3).
  if (isDemoIdentity({ id, email: session?.user?.email })) {
    return NextResponse.json({ error: DEMO_READ_ONLY_MESSAGE, demo: true }, { status: 403 });
  }

  // The plan ends with the account. Until 2026-09-24 the Stripe subscription outlived the delete
  // and kept charging a card for an account nobody could open. If Stripe can't be reached, nothing
  // is deleted: a retry costs the driver a minute, a missed cancel costs them money every month.
  const plan = await prisma.subscription.findUnique({
    where: { userId: id },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (plan?.stripeSubscriptionId && !ENDED_STATUSES.has(plan.status) && stripeConfigured()) {
    try {
      await getStripe().subscriptions.cancel(plan.stripeSubscriptionId);
    } catch (err) {
      // Already gone on Stripe's side is the outcome we wanted.
      const code = (err as { code?: string } | null)?.code;
      if (code !== "resource_missing") {
        console.error(`[account-delete] user=${id} could not cancel ${plan.stripeSubscriptionId}`, err);
        return NextResponse.json(
          { error: "We couldn't cancel your plan just now, so nothing was deleted. Try again in a minute." },
          { status: 502 },
        );
      }
    }
  }

  // Read the file refs first — the cascade below destroys the rows that point at them.
  const blobUrls = await collectUserBlobUrls(id);

  // Apple requires an app that offers Sign in with Apple to disconnect it when the account goes,
  // so the driver's Apple ID stops listing Trackside. Best effort: Apple being down must not keep
  // someone's account alive. The token and its Apple client are kept by `resolveSocialSignIn`.
  const appleLinks = await prisma.account.findMany({
    where: { userId: id, provider: "apple", refresh_token: { not: null } },
    select: { refresh_token: true, session_state: true },
  });
  await Promise.all(
    appleLinks.map((link) =>
      revokeAppleToken({
        refreshToken: link.refresh_token as string,
        clientId: link.session_state || appleAppClientId(),
      }),
    ),
  );

  await prisma.user.delete({ where: { id } });

  // After the DB delete, so a blob-storage outage can't block someone deleting their account.
  const blobs = await deleteBlobUrls(blobUrls);
  if (blobs.failed > 0) {
    console.error(`[account-delete] user=${id} left ${blobs.failed} orphaned blob(s)`);
  }

  return NextResponse.json({ ok: true });
}
