/**
 * Run: `npm run test:entitlement`
 *
 * Locks the Phase 5 grandfather RETIREMENT (MONETISATION_NORTH_STAR.md, 2026-08-01): billing
 * exemption is ADMINS ONLY. Allowlist rows and `AUTH_ALLOWED_EMAILS` are a sign-in gate, never an
 * entitlement grant — testers are comped via 100%-off promo codes through the normal checkout, so
 * a mistakenly-generous grandfather here would silently hand out free Pro that outlives a
 * cancelled comp.
 *
 * The admin path short-circuits BEFORE any Prisma query, so these assertions make no database
 * calls (dotenv only provides DATABASE_URL so the shared Prisma client can construct).
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

test("admin email is exempt (case-insensitive, no DB)", async () => {
  resetAuthEnv();
  process.env.AUTH_ADMIN_EMAILS = "boss@example.com";
  assert.equal(await isGrandfatheredEmail("boss@example.com"), true);
  assert.equal(await isGrandfatheredEmail("  BOSS@Example.com  "), true);
});

test("env-allowlisted email is NOT grandfathered — retired 2026-08-01, comps use codes", async () => {
  resetAuthEnv();
  process.env.AUTH_ALLOWED_EMAILS = "tester@example.com, other@example.com";
  assert.equal(await isGrandfatheredEmail("tester@example.com"), false);
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

test("AUTH_OPEN_SIGNUP grants nothing here — open signup must never grant access", async () => {
  resetAuthEnv();
  process.env.AUTH_OPEN_SIGNUP = "1";
  assert.equal(await isGrandfatheredEmail("anyone@example.com"), false);
});
