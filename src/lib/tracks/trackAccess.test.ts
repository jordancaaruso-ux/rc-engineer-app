/**
 * Run: `npx tsx src/lib/tracks/trackAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { canDeleteTrack, canManageCommunityTrack } from "@/lib/tracks/trackAccessLogic";

const creator = { id: "user-a", email: "a@example.com" };
const other = { id: "user-b", email: "b@example.com" };
const admin = { id: "user-admin", email: "admin@example.com" };
const track = { userId: "user-a" };

test("canManageCommunityTrack allows creator", () => {
  assert.equal(canManageCommunityTrack(creator, track), true);
});

test("canManageCommunityTrack denies non-creator", () => {
  assert.equal(canManageCommunityTrack(other, track), false);
});

test("canManageCommunityTrack allows admin email from env", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    assert.equal(canManageCommunityTrack(admin, track), true);
  } finally {
    if (prev === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = prev;
  }
});

test("canDeleteTrack matches canManageCommunityTrack", () => {
  assert.equal(canDeleteTrack(other, track), canManageCommunityTrack(other, track));
});
