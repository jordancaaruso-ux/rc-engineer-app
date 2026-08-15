import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * The magic link Auth.js would have emailed, minted directly — the one implementation, shared by
 * the paid-signup webhook (`billing/paidSignup.ts`) and the typed-code exchange
 * (`api/auth/verify-code`). Same scheme as `scripts/dev-fresh-onboarding.ts`: store
 * SHA-256(rawToken + AUTH_SECRET), raw token in the URL, provider id `nodemailer`.
 *
 * If the callback ever starts rejecting these, `@auth/core`'s `send-token.js` hash input or
 * provider id has changed — fix the dev script and this together. (It was previously a private
 * copy inside `paidSignup.ts` whose comment already asked for exactly that lockstep; extracting
 * it makes the ask enforceable rather than aspirational.)
 *
 * Minting a fresh token is deliberately how the typed code signs someone in: it means the code
 * path never forges a session cookie of its own. It hands the browser to the ordinary Auth.js
 * callback, which consumes the token, re-runs the allowlist `signIn` callback, and sets the
 * cookie itself. The one place that DOES forge a cookie (`devSessionCookie.ts`) throws in
 * production on purpose, and stays that way.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Origin-relative callback URL. Relative on purpose: the browser resolves it against whatever
 * origin it is already on, so the code path can't trip the `AUTH_URL`-points-somewhere-else
 * failure that `app/login/layout.tsx` exists to warn about. Safe because `trustHost: true` makes
 * Auth.js build from the request host, and its default `redirect` callback always permits a
 * `/`-relative `callbackUrl`.
 */
export async function mintMagicLinkPath(email: string, callbackPath = "/"): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot mint a sign-in link");

  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const params = new URLSearchParams({
    callbackUrl: callbackPath.startsWith("/") ? callbackPath : "/",
    token,
    email,
  });
  return `/api/auth/callback/nodemailer?${params}`;
}

/** Absolute form, for an email that has no origin to resolve against. */
export async function mintMagicLinkUrl(email: string): Promise<string> {
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/$/, "");
  return `${baseUrl}${await mintMagicLinkPath(email, "/")}`;
}
