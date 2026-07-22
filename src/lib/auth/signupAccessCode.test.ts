/**
 * Run: `npm run test:auth-access-code`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesSignupAccessCode,
  parseSignupAccessCodes,
} from "@/lib/auth/signupAccessCode";

test("parses comma- and whitespace-separated codes, lowercased", () => {
  assert.deepEqual(
    [...parseSignupAccessCodes("jrc-AAA, jrc-bbb\njrc-ccc")],
    ["jrc-aaa", "jrc-bbb", "jrc-ccc"]
  );
});

test("unset or blank env yields no codes", () => {
  assert.equal(parseSignupAccessCodes(undefined).size, 0);
  assert.equal(parseSignupAccessCodes("   ").size, 0);
  assert.equal(parseSignupAccessCodes(",, ,").size, 0);
});

test("no configured codes never opens the door", () => {
  const none = parseSignupAccessCodes(undefined);
  assert.equal(matchesSignupAccessCode("anything", none), false);
  assert.equal(matchesSignupAccessCode("", none), false);
});

test("matches any configured code, case- and whitespace-insensitive", () => {
  const codes = parseSignupAccessCodes("jrc-9f3a2c7e41, club-4b81de02");
  assert.equal(matchesSignupAccessCode("jrc-9f3a2c7e41", codes), true);
  assert.equal(matchesSignupAccessCode("  JRC-9F3A2C7E41 ", codes), true);
  assert.equal(matchesSignupAccessCode("club-4b81de02", codes), true);
});

test("rejects wrong, empty, and near-miss codes", () => {
  const codes = parseSignupAccessCodes("jrc-9f3a2c7e41");
  assert.equal(matchesSignupAccessCode("jrc-9f3a2c7e4", codes), false);
  assert.equal(matchesSignupAccessCode("jrc-9f3a2c7e411", codes), false);
  assert.equal(matchesSignupAccessCode("", codes), false);
  assert.equal(matchesSignupAccessCode(null, codes), false);
  assert.equal(matchesSignupAccessCode(undefined, codes), false);
});

test("revoking one code of several leaves the others working", () => {
  const before = parseSignupAccessCodes("jrc-aaa1111111, club-bbb2222222");
  const after = parseSignupAccessCodes("club-bbb2222222");
  assert.equal(matchesSignupAccessCode("jrc-aaa1111111", before), true);
  assert.equal(matchesSignupAccessCode("jrc-aaa1111111", after), false);
  assert.equal(matchesSignupAccessCode("club-bbb2222222", after), true);
});
