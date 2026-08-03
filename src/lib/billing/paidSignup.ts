import { createHash, randomBytes } from "node:crypto";
import { createTransport } from "nodemailer";
import { prisma } from "@/lib/prisma";
import { isMagicLinkSmtpConfigured } from "@/lib/emailAuthEnv";
import { renderMagicLinkEmail } from "@/lib/auth/magicLinkEmail";
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
 * The magic link Auth.js would have emailed, minted directly — same scheme as
 * `scripts/dev-fresh-onboarding.ts`: store SHA-256(rawToken + AUTH_SECRET), raw token in the URL,
 * provider id `nodemailer`. If the callback ever rejects these links, `@auth/core`'s
 * `send-token.js` hash input or provider id has changed — fix the dev script and this together.
 */
async function mintMagicLinkUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot mint a sign-in link");
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/$/, "");

  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const params = new URLSearchParams({ callbackUrl: `${baseUrl}/`, token, email });
  return `${baseUrl}/api/auth/callback/nodemailer?${params}`;
}

/**
 * Mint and email the post-payment sign-in link. Throws on send failure so the webhook 500s and
 * Stripe retries the event (provisioning is idempotent; an extra VerificationToken row just
 * expires). Without SMTP config (dev) the link is logged instead, matching `auth.ts`.
 */
export async function sendPaidSignupSignInLink(email: string): Promise<void> {
  const url = await mintMagicLinkUrl(email);
  if (!isMagicLinkSmtpConfigured()) {
    console.info(`[paid-signup] Magic link for ${email}:\n${url}\n`);
    return;
  }
  const transport = createTransport(process.env.EMAIL_SERVER?.trim());
  const rendered = renderMagicLinkEmail(url, email);
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
