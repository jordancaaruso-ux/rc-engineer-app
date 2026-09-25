import "server-only";

import { cookies } from "next/headers";
import { decode, encode } from "next-auth/jwt";

import type { SocialIdentity, SocialProvider } from "@/lib/auth/social/socialSignInLogic";

/**
 * An Apple or Google identity that matched no account, held while the driver answers "new, or
 * already have an account?" (`/login/connect`).
 *
 * It lives in an encrypted, httpOnly cookie in the browser (or app) that just finished the Apple
 * or Google sign-in, and nowhere else. That is the point: if it could travel in a link, someone
 * could send a driver their own pending identity, the driver would sign in to link it, and the
 * sender's Apple/Google would then open the driver's account. A cookie can't be planted that way.
 */

const COOKIE = "jrc_pending_link";
const SALT = "jrc-pending-link";
const MAX_AGE_SECONDS = 15 * 60;

export type PendingLink = SocialIdentity & {
  /** Apple's refresh token, fetched straight away: the one-time code behind it dies in 5 minutes. */
  appleRefreshToken: string | null;
  /** Which Apple client the token belongs to (app bundle id or website Services ID). */
  appleClientId: string | null;
};

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function isProvider(v: unknown): v is SocialProvider {
  return v === "apple" || v === "google";
}

function asPending(raw: unknown): PendingLink | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!isProvider(p.provider) || typeof p.sub !== "string" || !p.sub) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    provider: p.provider,
    sub: p.sub,
    email: str(p.email),
    emailVerified: p.emailVerified === true,
    isPrivateEmail: p.isPrivateEmail === true,
    name: str(p.name),
    image: str(p.image),
    appleRefreshToken: str(p.appleRefreshToken),
    appleClientId: str(p.appleClientId),
  };
}

/** Works in route handlers, including inside Auth.js callbacks (Next merges the cookie into
 * whatever response the handler returns). */
export async function setPendingLink(pending: PendingLink): Promise<void> {
  const sealed = await encode({
    token: { pending },
    secret: secret(),
    salt: SALT,
    maxAge: MAX_AGE_SECONDS,
  });
  (await cookies()).set(COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readPendingLink(): Promise<PendingLink | null> {
  const sealed = (await cookies()).get(COOKIE)?.value;
  if (!sealed) return null;
  try {
    const token = await decode({ token: sealed, secret: secret(), salt: SALT });
    return asPending((token as { pending?: unknown } | null)?.pending);
  } catch {
    return null;
  }
}

export async function clearPendingLink(): Promise<void> {
  // The path must match the one it was set with, or the browser keeps the original.
  (await cookies()).delete({ name: COOKIE, path: "/" });
}
