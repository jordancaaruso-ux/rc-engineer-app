import { NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { hasDatabaseUrl } from "@/lib/env";
import { resolveSocialSignIn } from "@/lib/auth/social/resolveSocialSignIn";
import {
  appleAppClientId,
  googleAudiences,
  isAppleSignInConfigured,
} from "@/lib/auth/social/socialConfig";
import { consumeSocialNonce } from "@/lib/auth/social/socialNonce";
import { joinName, safeCallbackPath, type SocialProvider } from "@/lib/auth/social/socialSignInLogic";
import { IdTokenError, verifyIdToken } from "@/lib/auth/social/verifyIdToken";

/**
 * Apple/Google sign-in from the iPhone app. The phone's own sign-in sheet hands the app an ID
 * token; the app posts it here with the nonce cookie from `/api/auth/social/nonce`. The answer is
 * where to go next: the ordinary magic-link path that signs the account in, or `/login/connect`
 * when no account can be tied to the identity for certain (`socialSignInLogic.ts`).
 *
 * The website doesn't come through here: its Apple button uses `/api/auth/apple/start`, and its
 * Google button the Auth.js redirect. Public by construction: the middleware skips `api/auth`.
 */

const TRY_AGAIN = "That sign-in didn't go through. Please try again.";

type Body = {
  provider?: unknown;
  idToken?: unknown;
  authorizationCode?: unknown;
  givenName?: unknown;
  familyName?: unknown;
  callbackPath?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const rl = checkApiRateLimit({
    key: `social-native:${clientIpKey(request)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as Body | null;
  const provider: SocialProvider | null =
    body?.provider === "apple" || body?.provider === "google" ? body.provider : null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : null;
  if (!provider || !idToken) {
    return NextResponse.json({ error: TRY_AGAIN }, { status: 400 });
  }
  if (provider === "apple" && !isAppleSignInConfigured()) {
    return NextResponse.json({ error: "Sign in with Apple isn't available yet." }, { status: 503 });
  }

  const nonce = await consumeSocialNonce();
  if (!nonce) {
    return NextResponse.json({ error: "That took too long. Please try again." }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyIdToken(provider, idToken, {
      audiences: provider === "apple" ? [appleAppClientId()] : googleAudiences(),
      nonce,
    });
  } catch (err) {
    if (!(err instanceof IdTokenError)) throw err;
    console.warn(`[social-signin] rejected ${err.message}`);
    return NextResponse.json({ error: TRY_AGAIN }, { status: 401 });
  }
  // Apple hands the name over beside the token, and only the first time.
  if (provider === "apple" && !identity.name) {
    identity = { ...identity, name: joinName(body?.givenName, body?.familyName) };
  }

  const outcome = await resolveSocialSignIn(identity, {
    callbackPath: safeCallbackPath(body?.callbackPath),
    apple:
      provider === "apple"
        ? {
            code: typeof body?.authorizationCode === "string" ? body.authorizationCode : null,
            clientId: appleAppClientId(),
          }
        : undefined,
  });
  return outcome.ok
    ? NextResponse.json({ next: outcome.next })
    : NextResponse.json({ error: outcome.error }, { status: 403 });
}
