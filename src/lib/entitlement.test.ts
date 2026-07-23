/**
 * Run: `npm run test:entitlement`
 *
 * Locks the ZERO-REGRESSION guarantee for existing users on the auth email allowlist: a
 * grandfathered account (allowlisted email OR admin) always resolves to full Pro access and is
 * never walled — even when the paywall is enforced.
 *
 * The admin + env-allowlist paths short-circuit BEFORE any Prisma query, so these assertions make
 * no database calls (dotenv only provides DATABASE_URL so the shared Prisma client can construct).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@prisma/client";
import { getEntitlement, isGrandfatheredEmail } from "@/lib/entitlement";

function fakeUser(email: string | null): User {
  return { id: "u_test", email } as unknown as User;
}

function resetAuthEnv() {
  delete process.env.BILLING_ENFORCED;
  delete process.env.AUTH_ALLOWED_EMAILS;
  delete process.env.AUTH_ADMIN_EMAILS;
  delete process.env.AUTH_OPEN_SIGNUP;
}

test("admin email is grandfathered (case-insensitive, no DB)", async () => {
  resetAuthEnv();
  process.env.AUTH_ADMIN_EMAILS = "boss@example.com";
  assert.equal(await isGrandfatheredEmail("boss@example.com"), true);
  assert.equal(await isGrandfatheredEmail("  BOSS@Example.com  "), true);
});

test("env-allowlisted email is grandfathered (case/space-insensitive, no DB)", async () => {
  resetAuthEnv();
  process.env.AUTH_ALLOWED_EMAILS = "tester@example.com, other@example.com";
  assert.equal(await isGrandfatheredEmail("tester@example.com"), true);
  assert.equal(await isGrandfatheredEmail(" Tester@example.com "), true);
});

test("allowlisted user stays full Pro even with the paywall ENFORCED", async () => {
  resetAuthEnv();
  process.env.BILLING_ENFORCED = "1";
  process.env.AUTH_ALLOWED_EMAILS = "tester@example.com";
  const ent = await getEntitlement(fakeUser("tester@example.com"));
  assert.deepEqual(ent, { tier: "pro", entitled: true, grandfathered: true });
});

test("admin stays full Pro even with the paywall ENFORCED", async () => {
  resetAuthEnv();
  process.env.BILLING_ENFORCED = "1";
  process.env.AUTH_ADMIN_EMAILS = "boss@example.com";
  const ent = await getEntitlement(fakeUser("boss@example.com"));
  assert.deepEqual(ent, { tier: "pro", entitled: true, grandfathered: true });
});

test("paywall DARK (BILLING_ENFORCED unset) → everyone keeps full access", async () => {
  resetAuthEnv();
  const ent = await getEntitlement(fakeUser("not-on-any-list@nobody.com"));
  assert.equal(ent.entitled, true);
  assert.equal(ent.tier, "pro");
});

test("grandfathering does NOT hinge on AUTH_OPEN_SIGNUP (allowlisted user still qualifies)", async () => {
  resetAuthEnv();
  process.env.AUTH_OPEN_SIGNUP = "1";
  process.env.AUTH_ALLOWED_EMAILS = "tester@example.com";
  // Open signup lets anyone authenticate, but grandfathering is decided only by the real invite
  // list — isGrandfatheredEmail never consults isEmailAuthAllowed, so open signup can't silently
  // grant or revoke it.
  assert.equal(await isGrandfatheredEmail("tester@example.com"), true);
});
