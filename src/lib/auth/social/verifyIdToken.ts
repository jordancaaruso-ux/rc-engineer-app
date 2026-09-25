import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import {
  identityFromClaims,
  type SocialIdentity,
  type SocialProvider,
} from "@/lib/auth/social/socialSignInLogic";

/**
 * Checks an Apple or Google ID token before anything trusts it: the signature against the
 * provider's published keys, the issuer, that it was issued to Trackside (audience), that it hasn't
 * expired, and that it carries the nonce this browser was handed (so a token caught elsewhere can't
 * be replayed into someone else's session). Only then is the email inside it believed.
 */

const ISSUERS: Record<SocialProvider, string[]> = {
  apple: ["https://appleid.apple.com"],
  google: ["https://accounts.google.com", "accounts.google.com"],
};

// Remote key sets cache the keys and refetch when a token names a key they haven't seen.
const REMOTE_KEYS: Record<SocialProvider, JWTVerifyGetKey> = {
  apple: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
  google: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
};

export class IdTokenError extends Error {}

export async function verifyIdTokenWithKeys(
  provider: SocialProvider,
  idToken: string,
  keys: JWTVerifyGetKey,
  expected: { audiences: string[]; nonce: string },
): Promise<SocialIdentity> {
  if (expected.audiences.length === 0) throw new IdTokenError(`${provider}: no audience configured`);
  let claims: Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, {
      issuer: ISSUERS[provider],
      audience: expected.audiences,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch (err) {
    throw new IdTokenError(`${provider}: ${err instanceof Error ? err.message : "invalid token"}`);
  }
  if (!expected.nonce || claims.nonce !== expected.nonce) {
    throw new IdTokenError(`${provider}: nonce mismatch`);
  }
  const identity = identityFromClaims(provider, claims);
  if (!identity) throw new IdTokenError(`${provider}: token has no subject`);
  return identity;
}

export function verifyIdToken(
  provider: SocialProvider,
  idToken: string,
  expected: { audiences: string[]; nonce: string },
): Promise<SocialIdentity> {
  return verifyIdTokenWithKeys(provider, idToken, REMOTE_KEYS[provider], expected);
}
