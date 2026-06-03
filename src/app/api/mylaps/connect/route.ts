import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getMylapsOAuthClientId,
  mylapsOAuthConfiguredForApp,
  mylapsOpenIdBase,
  mylapsRedirectUri,
} from "@/lib/mylaps/mylapsAuthConfig";
import { generatePkcePair } from "@/lib/mylaps/mylapsPkce";

const STATE_COOKIE = "mylaps_oauth_state";
const VERIFIER_COOKIE = "mylaps_oauth_verifier";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const origin = new URL(request.url).origin;
  const redirectUri = mylapsRedirectUri(origin);

  if (!mylapsOAuthConfiguredForApp()) {
    const settings = new URL("/settings", origin);
    settings.searchParams.set("mylaps", "oauth_unavailable");
    settings.searchParams.set(
      "mylaps_hint",
      "MYLAPS login redirect is not registered for this app yet. Use “Paste access token” below, or set MYLAPS_OAUTH_CLIENT_ID to an Azure app with redirect " +
        redirectUri
    );
    return NextResponse.redirect(settings);
  }

  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  jar.set(VERIFIER_COOKIE, codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: getMylapsOAuthClientId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid",
    response_mode: "query",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(`${mylapsOpenIdBase()}/authorize?${params}`);
}
