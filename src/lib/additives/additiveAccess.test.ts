/**
 * Run: `npx tsx --test src/lib/additives/additiveAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { additiveAccess, canChangeAdditive } from "@/lib/additives/additiveAccess";

const maker = { id: "u1", email: "zoe@example.com" };
const other = { id: "u2", email: "henry@example.com" };
const admin = { id: "u3", email: "admin@example.com" };
const zoesAdditive = { createdByUserId: "u1" };

function withAdminEnv<T>(fn: () => T): T {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    return fn();
  } finally {
    process.env.AUTH_ADMIN_EMAILS = prev;
  }
}

test("the maker may rename or delete their additive while nobody else uses it", () => {
  const access = additiveAccess(maker, zoesAdditive, false);
  assert.equal(access, "own");
  assert.equal(canChangeAdditive(access), true);
});

test("once another racer uses it, the maker is locked out and told why (test drive 13-2)", () => {
  const access = additiveAccess(maker, zoesAdditive, true);
  assert.equal(access, "in-use");
  assert.equal(canChangeAdditive(access), false);
});

test("another racer may never change it, used or not", () => {
  assert.equal(additiveAccess(other, zoesAdditive, false), "none");
  assert.equal(canChangeAdditive(additiveAccess(other, zoesAdditive, false)), false);
});

test("one of ours (no maker) is nobody's to change but an admin's", () => {
  assert.equal(additiveAccess(maker, { createdByUserId: null }, false), "none");
});

test("an admin may change anything, even in use", () => {
  withAdminEnv(() => {
    assert.equal(additiveAccess(admin, zoesAdditive, true), "admin");
    assert.equal(canChangeAdditive(additiveAccess(admin, { createdByUserId: null }, true)), true);
  });
});
