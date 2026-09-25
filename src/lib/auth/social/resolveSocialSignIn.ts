import "server-only";

import { Prisma } from "@prisma/client";

import { isEmailAuthAllowed } from "@/lib/authAllowlist";
import { mintMagicLinkPath } from "@/lib/auth/mintMagicLinkUrl";
import { exchangeAppleCode } from "@/lib/auth/social/appleTokens";
import { setPendingLink } from "@/lib/auth/social/pendingLink";
import {
  decideSocialSignIn,
  providerLabel,
  type SocialIdentity,
} from "@/lib/auth/social/socialSignInLogic";
import { prisma } from "@/lib/prisma";

/**
 * Turns a verified Apple/Google identity into a sign-in, by the rule in `socialSignInLogic.ts`.
 *
 * How it signs someone in: it mints the ordinary email magic-link path for the account
 * (`mintMagicLinkPath`, the same way the typed sign-in code does) and hands it back. The browser
 * goes there and Auth.js signs the account in, re-running the allowlist on the way. Nothing here
 * forges a session.
 *
 * Apple's refresh token lives on the `Account` row (`refresh_token`), with the Apple client it
 * belongs to in `session_state` (unused by Auth.js for these rows): Delete account needs both to
 * disconnect Apple.
 */

/** `code` lets the website's redirect say which failure it was without putting words in a URL. */
export type SocialFailureCode = "no-email" | "denied" | "taken";
export type SocialOutcome =
  | { ok: true; next: string }
  | { ok: false; code: SocialFailureCode; error: string };

export class LinkedElsewhereError extends Error {}

type AppleTokenOnFile = { refreshToken: string | null; clientId: string | null };

/** Links an identity to an account, or refreshes Apple's token on a link that already exists. */
export async function linkIdentity(
  userId: string,
  identity: Pick<SocialIdentity, "provider" | "sub">,
  apple?: AppleTokenOnFile,
): Promise<void> {
  const where = {
    provider_providerAccountId: { provider: identity.provider, providerAccountId: identity.sub },
  };
  const tokenFields = apple?.refreshToken
    ? { refresh_token: apple.refreshToken, session_state: apple.clientId }
    : {};
  const existing = await prisma.account.findUnique({ where, select: { userId: true } });
  if (existing) {
    if (existing.userId !== userId) throw new LinkedElsewhereError();
    if (apple?.refreshToken) await prisma.account.update({ where, data: tokenFields });
    return;
  }
  try {
    await prisma.account.create({
      data: {
        userId,
        type: "oidc",
        provider: identity.provider,
        providerAccountId: identity.sub,
        ...tokenFields,
      },
    });
  } catch (err) {
    // Two taps racing: the other request made the same link, which is the same end.
    const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!duplicate) throw err;
    const winner = await prisma.account.findUnique({ where, select: { userId: true } });
    if (winner?.userId !== userId) throw new LinkedElsewhereError();
  }
}

export async function resolveSocialSignIn(
  identity: SocialIdentity,
  opts: {
    /** Where to land once signed in (`/api/auth/social/finish` while linking). */
    callbackPath: string;
    /** Apple only: the one-time code and the client it was issued to. */
    apple?: { code: string | null; clientId: string; redirectUri?: string };
  },
): Promise<SocialOutcome> {
  const label = providerLabel(identity.provider);
  const linkedRow = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: { provider: identity.provider, providerAccountId: identity.sub },
    },
    select: { refresh_token: true, user: { select: { id: true, email: true } } },
  });
  const byEmail = identity.email
    ? await prisma.user.findUnique({
        where: { email: identity.email },
        select: { id: true, email: true },
      })
    : null;
  const decision = decideSocialSignIn({
    linked: linkedRow?.user ?? null,
    byEmail,
    emailVerified: identity.emailVerified,
  });

  // Swap Apple's one-time code for the refresh token Delete account needs, unless one is on file.
  let apple: AppleTokenOnFile | undefined;
  if (identity.provider === "apple" && opts.apple) {
    const refreshToken =
      opts.apple.code && !linkedRow?.refresh_token
        ? await exchangeAppleCode({
            code: opts.apple.code,
            clientId: opts.apple.clientId,
            redirectUri: opts.apple.redirectUri,
          })
        : null;
    apple = { refreshToken, clientId: opts.apple.clientId };
  }

  if (decision.kind === "sign-in") {
    const email = decision.user.email;
    if (!email) {
      return {
        ok: false,
        code: "no-email",
        error: `That ${label} account has no email we can sign in with.`,
      };
    }
    // The beta's door (`AUTH_ONLY_EMAILS`) holds here too.
    if (!(await isEmailAuthAllowed(email))) {
      return { ok: false, code: "denied", error: "This account can't sign in here." };
    }
    if (decision.link || apple?.refreshToken) {
      try {
        await linkIdentity(decision.user.id, identity, apple);
      } catch (err) {
        if (!(err instanceof LinkedElsewhereError)) throw err;
        return {
          ok: false,
          code: "taken",
          error: `That ${label} account is connected to a different Trackside account.`,
        };
      }
    }
    return { ok: true, next: await mintMagicLinkPath(email, opts.callbackPath) };
  }

  // No account can be tied to this identity for certain: ask rather than guess.
  if (!identity.email || !identity.emailVerified) {
    return {
      ok: false,
      code: "no-email",
      error: `${label} didn't share a verified email with us. Sign in with your email instead.`,
    };
  }
  await setPendingLink({
    ...identity,
    appleRefreshToken: apple?.refreshToken ?? null,
    appleClientId: apple?.clientId ?? null,
  });
  return { ok: true, next: "/login/connect" };
}
