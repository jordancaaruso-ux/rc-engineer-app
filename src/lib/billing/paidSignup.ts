import { createTransport } from "nodemailer";
import { prisma } from "@/lib/prisma";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { renderMagicLinkEmail } from "@/lib/auth/magicLinkEmail";
import { mintMagicLinkUrl } from "@/lib/auth/mintMagicLinkUrl";
import { issueSignInCode } from "@/lib/auth/signInCode";
import { DEV_EMAIL_FROM } from "@/lib/brand/brandNames";

/**
 * Paid-signup provisioning (MONETISATION_NORTH_STAR.md, Phase 1). Called by the Stripe webhook
 * when a `checkout.session.completed` arrives from the public door: a stranger paid, and now needs
 * an account and a way in. Every step is idempotent — a failed webhook retries the whole handler.
 *
 * Deliberately does NOT write an `AuthAllowedEmail` row: `isGrandfatheredEmail`
 * (`entitlement.ts`) treats every allowlist row as pre-paywall-tester-free-Pro-forever, so
 * allowlisting a payer would keep their access alive after they cancel. Sign-in for payers is
 * granted by `isEmailAuthAllowed`'s subscriber check instead (any account with a Subscription
 * row may sign in; entitlement decides what they can use).
 */

/**
 * Find-or-create the account for a paid signup and link the Stripe customer. The magic-link
 * callback matches on email, so a User row created here is signed straight into on the click —
 * same adapter behaviour the dev-fresh-onboarding script relies on.
 *
 * The customer id is written latest-wins: `syncSubscription` looks users up BY customer id, so a
 * re-purchase under a fresh Stripe customer must repoint the link or the new subscription would
 * never attach.
 */
export async function provisionPaidUser(
  email: string,
  stripeCustomerId: string,
): Promise<{ userId: string; created: boolean }> {
  const existing = await prisma.user.findFirst({
    where: { email },
    select: { id: true, stripeCustomerId: true },
  });
  if (existing) {
    if (existing.stripeCustomerId !== stripeCustomerId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { stripeCustomerId },
      });
    }
    return { userId: existing.id, created: false };
  }
  const user = await prisma.user.create({
    data: { email, stripeCustomerId },
    select: { id: true },
  });
  return { userId: user.id, created: true };
}

/**
 * Mint and email the post-payment way in. Throws on send failure so the webhook 500s and
 * Stripe retries the event (provisioning is idempotent; an extra VerificationToken row just
 * expires). Without SMTP config (dev) both credentials are logged instead, matching `auth.ts`.
 *
 * A payer gets the same email everyone else does — code first, link under it. They are the most
 * likely person of all to be stranded by the wrong browser: they arrive from Stripe Checkout,
 * often on a phone, with no account yet and no other way in.
 */
export async function sendPaidSignupSignInLink(email: string): Promise<void> {
  const url = await mintMagicLinkUrl(email);
  const code = await issueSignInCode(email);
  if (!isMagicLinkSmtpConfigured()) {
    console.info(`[paid-signup] Sign-in code for ${email}: ${code}\nMagic link:\n${url}\n`);
    return;
  }
  const transport = createTransport(process.env.EMAIL_SERVER?.trim());
  const rendered = renderMagicLinkEmail(url, email, code);
  const result = await transport.sendMail({
    to: email,
    from: process.env.EMAIL_FROM?.trim() || DEV_EMAIL_FROM,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  const failed = (result.rejected || []).concat(result.pending || []).filter(Boolean);
  if (failed.length) {
    throw new Error(`Paid-signup email (${failed.join(", ")}) could not be sent`);
  }
}
