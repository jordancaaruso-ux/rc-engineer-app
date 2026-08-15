/**
 * Run: `npm run test:sign-in-code`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeMatchesHash,
  evaluateCodeAttempt,
  generateSignInCode,
  hashSignInCode,
} from "@/lib/auth/signInCodeLogic";
import {
  MAX_CODE_ATTEMPTS,
  SIGN_IN_CODE_LENGTH,
  normalizeCodeInput,
} from "@/lib/auth/signInCodeShared";

const SECRET = "test-secret-not-a-real-one";
const LATER = new Date(Date.now() + 60_000);
const EARLIER = new Date(Date.now() - 60_000);

function row(code: string) {
  return { storedHash: hashSignInCode(code, SECRET), expires: LATER, secret: SECRET };
}

test("generates six digits, leading zeros preserved", () => {
  for (let i = 0; i < 500; i += 1) {
    const code = generateSignInCode();
    assert.equal(code.length, SIGN_IN_CODE_LENGTH);
    assert.match(code, /^[0-9]{6}$/);
  }
});

test("generator can produce a code below 100000 without losing width", () => {
  // Padding is the whole point: String(4217) would be a 4-char code that never matches.
  assert.equal(String(4217).padStart(SIGN_IN_CODE_LENGTH, "0"), "004217");
  assert.equal(hashSignInCode("004217", SECRET), hashSignInCode("004217", SECRET));
  assert.notEqual(hashSignInCode("004217", SECRET), hashSignInCode("4217", SECRET));
});

test("hash round-trips and is bound to the secret", () => {
  const hash = hashSignInCode("123456", SECRET);
  assert.equal(codeMatchesHash("123456", hash, SECRET), true);
  assert.equal(codeMatchesHash("123456", hash, "a-different-secret"), false);
  assert.equal(codeMatchesHash("654321", hash, SECRET), false);
});

test("a malformed stored hash is rejected, not thrown on", () => {
  assert.equal(codeMatchesHash("123456", "not-a-hash", SECRET), false);
  assert.equal(codeMatchesHash("123456", "", SECRET), false);
});

test("normalizes pasted formatting to bare digits", () => {
  assert.equal(normalizeCodeInput("123 456"), "123456");
  assert.equal(normalizeCodeInput("123-456"), "123456");
  assert.equal(normalizeCodeInput("  004217  "), "004217");
});

test("rejects anything that isn't exactly six digits", () => {
  assert.equal(normalizeCodeInput("12345"), null);
  assert.equal(normalizeCodeInput("1234567"), null);
  assert.equal(normalizeCodeInput("abcdef"), null);
  assert.equal(normalizeCodeInput(""), null);
  assert.equal(normalizeCodeInput(null), null);
  assert.equal(normalizeCodeInput(undefined), null);
});

test("correct code is accepted and burns the row", () => {
  const result = evaluateCodeAttempt({
    code: "123456",
    ...row("123456"),
    attemptsAfterIncrement: 1,
    now: new Date(),
  });
  assert.deepEqual(result, { ok: true, burn: true });
});

test("a wrong guess below the cap keeps the row alive", () => {
  for (let attempts = 1; attempts < MAX_CODE_ATTEMPTS; attempts += 1) {
    const result = evaluateCodeAttempt({
      code: "000000",
      ...row("123456"),
      attemptsAfterIncrement: attempts,
      now: new Date(),
    });
    assert.deepEqual(result, { ok: false, burn: false }, `attempt ${attempts}`);
  }
});

test("the last allowed wrong guess destroys the row", () => {
  const result = evaluateCodeAttempt({
    code: "000000",
    ...row("123456"),
    attemptsAfterIncrement: MAX_CODE_ATTEMPTS,
    now: new Date(),
  });
  assert.deepEqual(result, { ok: false, burn: true });
});

test("past the cap even the right code is refused", () => {
  // The row should already be gone; this is the belt for a racing second request.
  const result = evaluateCodeAttempt({
    code: "123456",
    ...row("123456"),
    attemptsAfterIncrement: MAX_CODE_ATTEMPTS + 1,
    now: new Date(),
  });
  assert.deepEqual(result, { ok: false, burn: true });
});

test("an expired row is refused and burned even with the right code", () => {
  const result = evaluateCodeAttempt({
    code: "123456",
    storedHash: hashSignInCode("123456", SECRET),
    expires: EARLIER,
    secret: SECRET,
    attemptsAfterIncrement: 1,
    now: new Date(),
  });
  assert.deepEqual(result, { ok: false, burn: true });
});
