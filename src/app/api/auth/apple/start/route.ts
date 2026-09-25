import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

import { appleWebClientId, isAppleSignInConfigured } from "@/lib/auth/social/socialConfig";
import { safeCallbackPath } from "@/lib/auth/social/socialSignInLogic";
import { APPLE_WEB_COOKIE, APPLE_WEB_SALT, appleWebRedirectUri } from "@/lib/auth/social/appleWeb";

/**
 * "Continue with Apple" on the website: send the browser to Apple, which posts the result back to
 * `/api/auth/apple/callback`. Not Auth.js's Apple provider: Apple's post back is a cross-site
 * POST, which drops the SameSite=Lax cookies Auth.js checks it against. Here the state and nonce
 * ride in our own short-lived SameSite=None cookie instead, scoped to `/api/auth/apple`.
 *
 * The iPhone app never comes here; it signs in with the phone's own Apple sheet
 * (`/api/auth/social/native`).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  if (!isAppleSignInConfigured()) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");

  const state = randomBytes(18).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const from = safeCallbackPath(url.searchParams.get("from"));
  const sealed = await encode({
    token: { state, nonce, from },
    secret,
    salt: APPLE_WEB_SALT,
    maxAge: 10 * 60,
  });

  const authorize = new URL("https://appleid.apple.com/auth/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code id_token",
    response_mode: "form_post",
    client_id: appleWebClientId(),
    redirect_uri: appleWebRedirectUri(url.origin),
    scope: "name email",
    state,
    nonce,
  }).toString();

  const res = NextResponse.redirect(authorize);
  res.cookies.set(APPLE_WEB_COOKIE, sealed, {
    httpOnly: true,
    // Apple's answer arrives as a cross-site POST; only a SameSite=None cookie rides along.
    sameSite: "none",
    secure: true,
    path: "/api/auth/apple",
    maxAge: 10 * 60,
  });
  return res;
}
