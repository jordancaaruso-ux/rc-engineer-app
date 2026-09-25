import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * The nonce that ties an Apple/Google token to the app (or browser) that asked for it. The app
 * fetches one, passes it into the native sign-in, and Apple/Google write it inside the token; the
 * server accepts the token only if it matches this cookie. A token lifted from somewhere else, or
 * posted by another site into a driver's session, carries the wrong nonce.
 *
 * Single use: reading it deletes it.
 */

const COOKIE = "jrc_social_nonce";
const PATH = "/api/auth/social";
const MAX_AGE_SECONDS = 10 * 60;

export async function issueSocialNonce(): Promise<string> {
  const nonce = randomBytes(24).toString("base64url");
  (await cookies()).set(COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: MAX_AGE_SECONDS,
  });
  return nonce;
}

export async function consumeSocialNonce(): Promise<string | null> {
  const jar = await cookies();
  const nonce = jar.get(COOKIE)?.value ?? null;
  if (nonce) jar.delete({ name: COOKIE, path: PATH });
  return nonce;
}
