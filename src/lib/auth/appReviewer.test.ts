/**
 * Run: `npm run test:sign-in-code`
 *
 * The App Store reviewer's fixed sign-in. The stakes: a mistake either locks Apple's reviewer out
 * (rejection) or opens someone else's account with a code that never expires.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAppReviewerCode, isAppReviewerEmail } from "@/lib/auth/appReviewer";

function withEnv(email: string | undefined, code: string | undefined, fn: () => void) {
  const before = { email: process.env.APP_REVIEW_EMAIL, code: process.env.APP_REVIEW_CODE };
  if (email === undefined) delete process.env.APP_REVIEW_EMAIL;
  else process.env.APP_REVIEW_EMAIL = email;
  if (code === undefined) delete process.env.APP_REVIEW_CODE;
  else process.env.APP_REVIEW_CODE = code;
  try {
    fn();
  } finally {
    if (before.email === undefined) delete process.env.APP_REVIEW_EMAIL;
    else process.env.APP_REVIEW_EMAIL = before.email;
    if (before.code === undefined) delete process.env.APP_REVIEW_CODE;
    else process.env.APP_REVIEW_CODE = before.code;
  }
}

test("switched off unless both the address and the code are set", () => {
  withEnv(undefined, undefined, () => {
    assert.equal(isAppReviewerEmail("review@example.com"), false);
    assert.equal(isAppReviewerCode("review@example.com", "123456"), false);
  });
  withEnv("review@example.com", undefined, () => {
    assert.equal(isAppReviewerEmail("review@example.com"), false);
  });
  withEnv(undefined, "123456", () => {
    assert.equal(isAppReviewerCode("review@example.com", "123456"), false);
  });
  // A code that isn't six digits is no code at all.
  withEnv("review@example.com", "12345", () => {
    assert.equal(isAppReviewerEmail("review@example.com"), false);
  });
});

test("only the reviewer's address, in any case, with only its code", () => {
  withEnv(" Review@Example.com ", "123456", () => {
    assert.equal(isAppReviewerEmail("review@example.com"), true);
    assert.equal(isAppReviewerEmail("REVIEW@example.com"), true);
    assert.equal(isAppReviewerEmail("driver@example.com"), false);
    assert.equal(isAppReviewerEmail(null), false);
    assert.equal(isAppReviewerCode("review@example.com", "123456"), true);
    assert.equal(isAppReviewerCode("review@example.com", "123457"), false);
    assert.equal(isAppReviewerCode("review@example.com", "1234567"), false);
    // The right code on anyone else's address opens nothing.
    assert.equal(isAppReviewerCode("driver@example.com", "123456"), false);
  });
});
