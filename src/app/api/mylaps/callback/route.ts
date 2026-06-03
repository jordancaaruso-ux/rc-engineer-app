import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getMylapsOAuthClientId,
  getMylapsOAuthClientSecret,
  mylapsRedirectUri,
} from "@/lib/mylaps/mylapsAuthConfig";
import { saveMylapsConnection } from "@/lib/mylaps/mylapsConnection";
import {
  accountIdFromMylapsClaims,
  exchangeMylapsAuthorizationCode,
  fetchMylapsChipNumbers,
  fetchMylapsClaims,
} from "@/lib/mylaps/mylapsUsersApi";

const STATE_COOKIE = "mylaps_oauth_state";
const VERIFIER_COOKIE = "mylaps_oauth_verifier";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const settings = new URL("/settings", origin);

  if (!hasDatabaseUrl()) {
    settings.searchParams.set("mylaps", "error");
    settings.searchParams.set("mylaps_hint", "Database not configured.");
    return NextResponse.redirect(settings);
  }

  const user = await getAuthenticatedApiUser();
  if (!user) {
    const login = new URL("/login", origin);
    login.searchParams.set("from", "/settings");
    return NextResponse.redirect(login);
  }

  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  if (err) {
    settings.searchParams.set("mylaps", "error");
    settings.searchParams.set(
      "mylaps_hint",
      errDesc?.slice(0, 240) || err
    );
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    settings.searchParams.set("mylaps", "error");
    settings.searchParams.set("mylaps_hint", "Invalid OAuth state. Try connecting again.");
    return NextResponse.redirect(settings);
  }

  try {
    const redirectUri = mylapsRedirectUri(origin);
    const token = await exchangeMylapsAuthorizationCode({
      code,
      redirectUri,
      clientId: getMylapsOAuthClientId(),
      clientSecret: getMylapsOAuthClientSecret(),
      codeVerifier: codeVerifier ?? null,
    });

    const accessToken = token.access_token;
    const claims = await fetchMylapsClaims(accessToken);
    const accountId = accountIdFromMylapsClaims(claims, accessToken);
    if (!accountId) {
      throw new Error("Could not read MYLAPS account id from token.");
    }

    let chipNumbers: number[] = [];
    try {
      chipNumbers = await fetchMylapsChipNumbers(accountId, accessToken);
    } catch {
      chipNumbers = [];
    }

    const expiresAt =
      typeof token.expires_in === "number" && token.expires_in > 0
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null;

    await saveMylapsConnection(user.id, {
      accountId,
      accessToken,
      refreshToken: token.refresh_token ?? null,
      expiresAt,
      chipNumbers,
    });

    settings.searchParams.set("mylaps", "connected");
    return NextResponse.redirect(settings);
  } catch (e) {
    settings.searchParams.set("mylaps", "error");
    settings.searchParams.set(
      "mylaps_hint",
      e instanceof Error ? e.message : "MYLAPS connection failed."
    );
    return NextResponse.redirect(settings);
  }
}
