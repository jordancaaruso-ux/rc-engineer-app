/**
 * Run: `npm run test:paid-signup`
 *
 * Proves the pure paid-door decisions: which checkout sessions count as public signups, and what
 * email gets provisioned. The stakes: a false positive provisions an account nobody paid for a
 * signup on; a mangled email strands a payer with no way in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_SIGNUP_FROM,
  PUBLIC_SIGNUP_SOURCE,
  extractCheckoutEmail,
  isAppSignupSession,
  isPublicSignupSession,
  normalizeSignupEmail,
  resolveCheckoutOwner,
} from "@/lib/billing/paidSignupLogic";

test("normalizeSignupEmail lowercases, trims, and rejects junk", () => {
  assert.equal(normalizeSignupEmail("  Driver@Example.COM "), "driver@example.com");
  assert.equal(normalizeSignupEmail("no-at-sign"), null);
  assert.equal(normalizeSignupEmail("space in@example.com"), null);
  assert.equal(normalizeSignupEmail(""), null);
  assert.equal(normalizeSignupEmail(null), null);
  assert.equal(normalizeSignupEmail(undefined), null);
});

test("only the exact metadata stamp marks a public signup", () => {
  assert.equal(isPublicSignupSession({ metadata: { source: PUBLIC_SIGNUP_SOURCE } }), true);
  // An authenticated checkout that omits client_reference_id must NOT read as a stranger.
  assert.equal(isPublicSignupSession({ client_reference_id: null, metadata: null }), false);
  assert.equal(isPublicSignupSession({ metadata: { source: "something-else" } }), false);
  assert.equal(isPublicSignupSession({}), false);
});

test("only a checkout from the app's welcome email skips the sign-in email", () => {
  assert.equal(
    isAppSignupSession({ metadata: { source: PUBLIC_SIGNUP_SOURCE, from: APP_SIGNUP_FROM } }),
    true,
  );
  // A stranger paying on the website has no account yet — the code email is their only way in.
  assert.equal(isAppSignupSession({ metadata: { source: PUBLIC_SIGNUP_SOURCE } }), false);
  assert.equal(isAppSignupSession({ metadata: null }), false);
  assert.equal(isAppSignupSession({}), false);
});

test("extractCheckoutEmail prefers what the buyer typed into Checkout", () => {
  assert.equal(
    extractCheckoutEmail({
      customer_details: { email: "Typed@Checkout.com" },
      customer_email: "prefill@example.com",
    }),
    "typed@checkout.com",
  );
});

test("extractCheckoutEmail falls back to the pre-fill, then null", () => {
  assert.equal(
    extractCheckoutEmail({ customer_details: null, customer_email: "PreFill@Example.com" }),
    "prefill@example.com",
  );
  assert.equal(extractCheckoutEmail({ customer_details: { email: null } }), null);
  assert.equal(extractCheckoutEmail({}), null);
});

test("a malformed typed email falls through to the pre-fill rather than dying", () => {
  assert.equal(
    extractCheckoutEmail({
      customer_details: { email: "broken address" },
      customer_email: "good@example.com",
    }),
    "good@example.com",
  );
});

test("a checkout naming the demo account provisions the payer's own account", () => {
  const isDemo = (id: string) => id === "demo0000000000000000user1";
  // Opened from a demo session before the checkout fix: no public stamp, the demo as reference.
  assert.deepEqual(
    resolveCheckoutOwner({ client_reference_id: "demo0000000000000000user1", metadata: null }, isDemo),
    { memberUserId: null, publicSignup: true },
  );
  // A real member's checkout still links to them and is never a public signup.
  assert.deepEqual(
    resolveCheckoutOwner({ client_reference_id: "member-1", metadata: null }, isDemo),
    { memberUserId: "member-1", publicSignup: false },
  );
  // A stranger's checkout: no reference, the public stamp.
  assert.deepEqual(
    resolveCheckoutOwner({ metadata: { source: PUBLIC_SIGNUP_SOURCE } }, isDemo),
    { memberUserId: null, publicSignup: true },
  );
  // Neither a reference nor the stamp: nobody to provision.
  assert.deepEqual(resolveCheckoutOwner({ metadata: null }, isDemo), {
    memberUserId: null,
    publicSignup: false,
  });
});
