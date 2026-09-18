/**
 * Run: `npx tsx src/lib/tracks/trackAccess.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canDeleteTrack,
  canEditLiveRcUrl,
  canManageCommunityTrack,
} from "@/lib/tracks/trackAccessLogic";

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

/*
 * `canEditLiveRcUrl` — the one track field that is identity rather than contribution.
 * Founder call 2026-09-18: tags, pin and Speedhive are open to any driver, and correctable by
 * any driver; a LiveRC catalog row's URL is not, because it is the row's key in the catalog.
 */

test("canEditLiveRcUrl refuses a driver on a LiveRC catalog row", () => {
  assert.equal(canEditLiveRcUrl(other, { catalogSource: "liverc" }), false);
  // The creator has no special claim either — the importer owns these rows, not a person.
  assert.equal(canEditLiveRcUrl(creator, { catalogSource: "liverc" }), false);
});

test("canEditLiveRcUrl allows any driver on a track a user made, or an OSM row", () => {
  assert.equal(canEditLiveRcUrl(other, { catalogSource: null }), true);
  assert.equal(canEditLiveRcUrl(other, { catalogSource: "osm" }), true);
});

test("canEditLiveRcUrl allows an admin to fix a catalog row", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
  try {
    assert.equal(canEditLiveRcUrl(admin, { catalogSource: "liverc" }), true);
  } finally {
    process.env.AUTH_ADMIN_EMAILS = prev;
  }
});
