import "server-only";

import { createSign } from "node:crypto";

import { appleKeyId, applePrivateKey, appleTeamId } from "@/lib/auth/social/socialConfig";

/**
 * The two server-to-Apple calls Sign in with Apple needs:
 *
 *  - exchange the one-time authorization code for a refresh token, kept on the `Account` row;
 *  - revoke that refresh token when the driver deletes their account. Apple requires this of every
 *    app that offers Sign in with Apple, so the driver's Apple ID stops listing Trackside as
 *    signed in.
 *
 * Both are best effort and never throw: Apple being slow must not stop a driver signing in, and
 * must not stop them deleting their account either.
 */

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const TIMEOUT_MS = 8000;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The "client secret" Apple wants: a short-lived ES256 token signed with the Sign in with Apple
 * key, naming the client (the app's bundle id, or the website's Services ID) it speaks for.
 */
function clientSecret(clientId: string): string | null {
  const keyId = appleKeyId();
  const teamId = appleTeamId();
  const key = applePrivateKey();
  if (!keyId || !teamId || !key) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64Url(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 5 * 60,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  // Apple wants the JOSE (r||s) form, not the DER encoding Node emits by default.
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64Url(signature)}`;
}

async function postForm(url: string, form: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/** The refresh token for a fresh sign-in, or null (logged) when Apple wouldn't give one. */
export async function exchangeAppleCode(input: {
  code: string;
  clientId: string;
  /** Required by Apple when the code came from the website's redirect; absent in the app. */
  redirectUri?: string;
}): Promise<string | null> {
  const secret = clientSecret(input.clientId);
  if (!secret || !input.code) return null;
  const res = await postForm(APPLE_TOKEN_URL, {
    client_id: input.clientId,
    client_secret: secret,
    code: input.code,
    grant_type: "authorization_code",
    ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
  });
  if (!res?.ok) {
    const reason = res ? await res.text().catch(() => "") : "unreachable";
    console.error(`[apple-signin] code exchange failed (${res?.status ?? 0}) ${reason.slice(0, 120)}`);
    return null;
  }
  const body = (await res.json().catch(() => null)) as { refresh_token?: unknown } | null;
  return typeof body?.refresh_token === "string" ? body.refresh_token : null;
}

export async function revokeAppleToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<boolean> {
  const secret = clientSecret(input.clientId);
  if (!secret) return false;
  const res = await postForm(APPLE_REVOKE_URL, {
    client_id: input.clientId,
    client_secret: secret,
    token: input.refreshToken,
    token_type_hint: "refresh_token",
  });
  if (!res?.ok) {
    console.error(`[apple-signin] revoke failed (${res?.status ?? 0}) for client ${input.clientId}`);
    return false;
  }
  return true;
}
