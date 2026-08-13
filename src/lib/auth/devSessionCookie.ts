import "server-only";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

/**
 * Sign a user in directly, without Auth.js's magic-link round trip. DEV ONLY.
 *
 * The problem it solves: Auth.js builds every redirect from `AUTH_URL`, and `.env.local` pins that
 * to `http://localhost:3000`. Load a sign-in link from a phone on `http://192.168.x.x:3000` and the
 * callback signs you in, then sends you to a localhost URL the phone cannot reach — and a
 * cross-origin `callbackUrl` does not help, because `@auth/core`'s default `redirect` callback
 * replaces any origin that isn't the base URL with the base URL itself. `trustHost: true` does not
 * override `AUTH_URL`; when it is set, it wins.
 *
 * Sessions here are JWT (`auth.config.ts`), so the cookie IS the session — there is no `Session`
 * row to write, and issuing one ourselves skips Auth.js's redirect machinery entirely. The only
 * URL left in the flow is the one the browser actually loaded.
 *
 * Not for production: real sign-in must stay on the audited path (allowlist gate, token exchange,
 * one canonical origin). Callers 404 in production before reaching this; the throw is the backstop.
 */

/** Matches `auth.config.ts`'s `session.maxAge`, so a minted cookie ages like a real one. */
const MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Must match `@auth/core`'s `defaultCookies()` byte for byte: the name doubles as the JWT salt, so
 * a mismatch decrypts to nothing and the middleware bounces to /login with no visible error.
 */
function sessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

/**
 * A redirect to `to`, resolved against the REQUEST's origin (never `AUTH_URL`), carrying a freshly
 * signed session cookie for `userId`.
 *
 * `picture` is left null deliberately: `auth.ts`'s jwt callback backfills the avatar from the DB on
 * the next request whenever it is falsy, which is exactly the state a real magic-link sign-in
 * leaves behind.
 */
export async function redirectSignedIn(params: {
  request: Request;
  userId: string;
  email: string;
  to?: string;
}): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("redirectSignedIn is dev-only — production must use the real sign-in path.");
  }
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");

  // `request.url` is NOT the URL the browser typed — measured 2026-08-13: a phone hitting
  // `http://192.168.50.91:3000/...` produced `http://localhost:3000/...` here, so building the
  // redirect from it sent the phone straight back to a host it cannot reach. The forwarded proto
  // header is the only trustworthy signal about the scheme, and the Location below dodges the
  // question of the host entirely.
  const forwardedProto = params.request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwardedProto
    ? forwardedProto === "https"
    : new URL(params.request.url).protocol === "https:";
  const name = sessionCookieName(secure);

  const token = await encode({
    salt: name,
    secret,
    maxAge: MAX_AGE,
    token: { sub: params.userId, email: params.email, name: null, picture: null },
  });

  // A RELATIVE Location (RFC 7231 §7.1.2) — the browser resolves it against the URL it actually
  // requested, so this lands on whatever host you loaded without the server having to guess one.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: params.to ?? "/" },
  });
  response.cookies.set(name, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: MAX_AGE,
  });
  return response;
}
