/**
 * Run: `npm run test:social-sign-in`
 *
 * The rule that decides which account an Apple/Google sign-in opens (nobody gets a second account
 * by accident), and the checks a token must pass before its email is believed. Tokens are signed
 * here with a throwaway key, so no network and no real Apple/Google account is involved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

import {
  claimIsTrue,
  connectSignInPath,
  decideSocialSignIn,
  identityFromClaims,
  joinName,
  normalizeIdentityEmail,
  safeCallbackPath,
} from "@/lib/auth/social/socialSignInLogic";
import { IdTokenError, verifyIdTokenWithKeys } from "@/lib/auth/social/verifyIdToken";

const DRIVER = { id: "u1", email: "sam@example.com" };
const OTHER = { id: "u2", email: "other@example.com" };

test("an identity already linked opens its account, whatever its email says", () => {
  assert.deepEqual(decideSocialSignIn({ linked: DRIVER, byEmail: OTHER, emailVerified: true }), {
    kind: "sign-in",
    user: DRIVER,
    link: false,
  });
});

test("a verified email that matches an account opens it and links", () => {
  assert.deepEqual(decideSocialSignIn({ linked: null, byEmail: DRIVER, emailVerified: true }), {
    kind: "sign-in",
    user: DRIVER,
    link: true,
  });
});

test("an unverified email never opens the account that carries it", () => {
  assert.deepEqual(decideSocialSignIn({ linked: null, byEmail: DRIVER, emailVerified: false }), {
    kind: "choose",
  });
});

test("no link and no matching email: ask, never make an account", () => {
  // Hide My Email lands here: the relay address matches nobody.
  assert.deepEqual(decideSocialSignIn({ linked: null, byEmail: null, emailVerified: true }), {
    kind: "choose",
  });
});

test("claims: Apple's string booleans, hidden email, name and picture", () => {
  assert.equal(claimIsTrue("true"), true);
  assert.equal(claimIsTrue(true), true);
  assert.equal(claimIsTrue("false"), false);
  assert.equal(claimIsTrue(undefined), false);

  const apple = identityFromClaims("apple", {
    sub: "001.abc",
    email: "X7Q@privaterelay.appleid.com",
    email_verified: "true",
    is_private_email: "true",
  });
  assert.deepEqual(apple, {
    provider: "apple",
    sub: "001.abc",
    email: "x7q@privaterelay.appleid.com",
    emailVerified: true,
    isPrivateEmail: true,
    name: null,
    image: null,
  });

  const google = identityFromClaims("google", {
    sub: "1098",
    email: "Sam@Example.com",
    email_verified: true,
    name: " Sam Driver ",
    picture: "https://lh3.googleusercontent.com/a/x",
  });
  assert.equal(google?.email, "sam@example.com");
  assert.equal(google?.name, "Sam Driver");
  assert.equal(google?.isPrivateEmail, false, "only Apple hides emails");
  assert.equal(google?.image, "https://lh3.googleusercontent.com/a/x");

  // No email claim at all: verified can't be true.
  assert.equal(identityFromClaims("apple", { sub: "s", email_verified: "true" })?.emailVerified, false);
  assert.equal(identityFromClaims("google", { email: "a@b.c" }), null, "no subject, no identity");
});

test("small helpers", () => {
  assert.equal(normalizeIdentityEmail(" A@B.co "), "a@b.co");
  assert.equal(normalizeIdentityEmail("not an email"), null);
  assert.equal(joinName(" Sam ", "Driver"), "Sam Driver");
  assert.equal(joinName(null, undefined), null);
  assert.equal(safeCallbackPath("/api/auth/social/finish"), "/api/auth/social/finish");
  assert.equal(safeCallbackPath("//evil.example"), "/");
  assert.equal(safeCallbackPath("https://evil.example"), "/");
  assert.equal(
    connectSignInPath("apple"),
    "/login?connect=apple&from=%2Fapi%2Fauth%2Fsocial%2Ffinish",
  );
});

// ---- Token checks ------------------------------------------------------------------------------

const APPLE_ISS = "https://appleid.apple.com";
const APP_AUD = "com.rcengineer.app";

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string | number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? APPLE_ISS)
      .setAudience(opts.aud ?? APP_AUD)
      .setSubject("001.sub")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "10m")
      .sign(privateKey);
  return { keys, sign };
}

test("a good Apple token gives its identity", async () => {
  const { keys, sign } = await signer();
  const token = await sign({ nonce: "n-1", email: "sam@example.com", email_verified: "true" });
  const identity = await verifyIdTokenWithKeys("apple", token, keys, {
    audiences: [APP_AUD],
    nonce: "n-1",
  });
  assert.equal(identity.sub, "001.sub");
  assert.equal(identity.emailVerified, true);
});

test("refused: wrong nonce, no nonce, wrong app, wrong issuer, expired, forged", async () => {
  const { keys, sign } = await signer();
  const expect = { audiences: [APP_AUD], nonce: "n-1" };
  const refused = async (token: string, why: string, exp = expect) =>
    assert.rejects(verifyIdTokenWithKeys("apple", token, keys, exp), IdTokenError, why);

  await refused(await sign({ nonce: "n-2" }), "a token asked for by another session");
  await refused(await sign({}), "a token with no nonce");
  await refused(await sign({ nonce: "n-1" }), "an empty expected nonce never passes", {
    audiences: [APP_AUD],
    nonce: "",
  });
  await refused(await sign({ nonce: "n-1" }, { aud: "com.someone.else" }), "issued to another app");
  await refused(await sign({ nonce: "n-1" }, { iss: "https://accounts.google.com" }), "not Apple");
  await refused(
    await sign({ nonce: "n-1" }, { exp: Math.floor(Date.now() / 1000) - 3600 }),
    "expired an hour ago",
  );

  // Signed by a key that isn't Apple's.
  const stranger = await signer();
  await refused(await stranger.sign({ nonce: "n-1" }), "someone else's key");

  // Tampered: the payload swapped after signing.
  const good = await sign({ nonce: "n-1", email: "sam@example.com" });
  const [h, , s] = good.split(".");
  const evil = Buffer.from(
    JSON.stringify({ iss: APPLE_ISS, aud: APP_AUD, sub: "001.sub", nonce: "n-1", email: "boss@example.com", exp: 9999999999 }),
  ).toString("base64url");
  await refused(`${h}.${evil}.${s}`, "payload edited after signing");

  // No audience configured at all (a missing env var) refuses rather than accepting anything.
  await refused(await sign({ nonce: "n-1" }), "no audience configured", { audiences: [], nonce: "n-1" });
});

test("Google tokens: either issuer spelling, web or iPhone client", async () => {
  const { keys, sign } = await signer();
  const expect = { audiences: ["web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"], nonce: "g" };
  for (const iss of ["https://accounts.google.com", "accounts.google.com"]) {
    for (const aud of expect.audiences) {
      const token = await sign({ nonce: "g", email: "sam@example.com", email_verified: true }, { iss, aud });
      const identity = await verifyIdTokenWithKeys("google", token, keys, expect);
      assert.equal(identity.provider, "google");
      assert.equal(identity.emailVerified, true);
    }
  }
  const apple = await sign({ nonce: "g" }, { aud: expect.audiences[0] });
  await assert.rejects(verifyIdTokenWithKeys("google", apple, keys, expect), IdTokenError, "Apple's issuer is not Google's");
});
