import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

import { APPLE_WEB_COOKIE, APPLE_WEB_SALT, appleWebRedirectUri } from "@/lib/auth/social/appleWeb";
import { resolveSocialSignIn } from "@/lib/auth/social/resolveSocialSignIn";
import { appleWebClientId } from "@/lib/auth/social/socialConfig";
import { joinName, safeCallbackPath } from "@/lib/auth/social/socialSignInLogic";
import { IdTokenError, verifyIdToken } from "@/lib/auth/social/verifyIdToken";

/**
 * Where Apple posts the website's "Continue with Apple" result (`response_mode=form_post`). Checks
 * the state and nonce against the cookie `/api/auth/apple/start` set, verifies the token, then
 * sends the browser on: to the magic-link path that signs the account in, or to `/login/connect`
 * when no account can be tied to the identity for certain.
 *
 * Failures land back on /login with a short code the page turns into words.
 */

type Saved = { state?: unknown; nonce?: unknown; from?: unknown };

/** First sign-in only: `{"name":{"firstName":"…","lastName":"…"},"email":"…"}`. */
function nameFromUserField(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  try {
    const user = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    return joinName(user.name?.firstName, user.name?.lastName);
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, origin), 303);
    // One use only, whatever happened.
    res.cookies.set(APPLE_WEB_COOKIE, "", {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/api/auth/apple",
      maxAge: 0,
    });
    return res;
  };

  const form = await request.formData().catch(() => null);
  if (!form) return go("/login?error=social");
  // The driver closed Apple's sheet: back to the sign-in page, nothing to say.
  if (form.get("error")) return go("/login");

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const sealed = (await cookies()).get(APPLE_WEB_COOKIE)?.value;
  const saved = (
    secret && sealed
      ? await decode({ token: sealed, secret, salt: APPLE_WEB_SALT }).catch(() => null)
      : null
  ) as Saved | null;
  const state = form.get("state");
  if (!saved || typeof saved.state !== "string" || state !== saved.state) {
    return go("/login?error=social");
  }

  const idToken = form.get("id_token");
  if (typeof idToken !== "string" || typeof saved.nonce !== "string") {
    return go("/login?error=social");
  }
  let identity;
  try {
    identity = await verifyIdToken("apple", idToken, {
      audiences: [appleWebClientId()],
      nonce: saved.nonce,
    });
  } catch (err) {
    if (!(err instanceof IdTokenError)) throw err;
    console.warn(`[social-signin] rejected ${err.message}`);
    return go("/login?error=social");
  }
  if (!identity.name) identity = { ...identity, name: nameFromUserField(form.get("user")) };

  const code = form.get("code");
  const outcome = await resolveSocialSignIn(identity, {
    callbackPath: safeCallbackPath(saved.from),
    apple: {
      code: typeof code === "string" ? code : null,
      clientId: appleWebClientId(),
      redirectUri: appleWebRedirectUri(origin),
    },
  });
  return go(outcome.ok ? outcome.next : `/login?error=social-${outcome.code}`);
}
