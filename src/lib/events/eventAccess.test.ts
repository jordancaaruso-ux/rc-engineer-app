/**
 * Run: `npx tsx src/lib/events/eventAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditSharedEventFields } from "@/lib/events/eventAccessLogic";

const creator = { id: "user-a", email: "a@example.com" };
const other = { id: "user-b", email: "b@example.com" };
const admin = { id: "user-admin", email: "admin@example.com" };

test("canEditSharedEventFields allows event creator", () => {
  assert.equal(canEditSharedEventFields(creator, { userId: "user-a" }), true);
});

test("canEditSharedEventFields denies non-creator", () => {
  assert.equal(canEditSharedEventFields(other, { userId: "user-a" }), false);
});

test("canEditSharedEventFields denies non-admin when creator is null", () => {
  assert.equal(canEditSharedEventFields(other, { userId: null }), false);
});

test("canEditSharedEventFields allows admin for legacy null creator", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    assert.equal(canEditSharedEventFields(admin, { userId: null }), true);
  } finally {
    if (prev === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = prev;
  }
});
