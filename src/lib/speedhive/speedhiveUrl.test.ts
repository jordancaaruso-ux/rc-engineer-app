/**
 * Run: `npx tsx src/lib/speedhive/speedhiveUrl.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSpeedhivePracticeLocationId,
  parseSpeedhivePracticeActivityRef,
} from "./speedhivePracticeUrl";
import {
  isSpeedhiveOrApiUrl,
  organizationIdFromTrackUrl,
  parseSpeedhiveOrganizationId,
  parseSpeedhiveSessionRef,
  validateSpeedhiveTrackUrl,
} from "./speedhiveUrl";

test("parseSpeedhiveOrganizationId from speedhive organization page", () => {
  assert.equal(
    parseSpeedhiveOrganizationId(
      "https://speedhive.mylaps.com/en/events/organizations/4242/overview"
    ),
    4242
  );
});

test("parseSpeedhiveOrganizationId from api2 organization URL", () => {
  assert.equal(
    parseSpeedhiveOrganizationId("https://api2.mylaps.com/api/organizations/99"),
    99
  );
});

test("validateSpeedhiveTrackUrl rejects non-speedhive host", () => {
  const v = validateSpeedhiveTrackUrl("https://example.com/organizations/1");
  assert.equal(v.ok, false);
});

test("validateSpeedhiveTrackUrl accepts organization page", () => {
  const v = validateSpeedhiveTrackUrl(
    "https://speedhive.mylaps.com/organizations/4242"
  );
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.kind, "organization");
    assert.equal(v.organizationId, 4242);
    assert.equal(v.practiceLocationId, null);
    assert.match(v.normalized, /organizations\/4242/i);
  }
});

test("parseSpeedhivePracticeLocationId from practice track page", () => {
  assert.equal(
    parseSpeedhivePracticeLocationId("https://speedhive.mylaps.com/practice/4591"),
    4591
  );
});

test("validateSpeedhiveTrackUrl accepts practice track page", () => {
  const v = validateSpeedhiveTrackUrl("https://speedhive.mylaps.com/practice/4591");
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.kind, "practice");
    assert.equal(v.practiceLocationId, 4591);
    assert.equal(v.organizationId, null);
    assert.equal(v.normalized, "https://speedhive.mylaps.com/practice/4591");
  }
});

test("parseSpeedhivePracticeActivityRef", () => {
  const ref = parseSpeedhivePracticeActivityRef(
    "https://speedhive.mylaps.com/practice/4591/activities/7875691978"
  );
  assert.ok(ref);
  assert.equal(ref.locationId, 4591);
  assert.equal(ref.activityId, 7875691978);
});

test("organizationIdFromTrackUrl returns null for empty", () => {
  assert.equal(organizationIdFromTrackUrl(null), null);
  assert.equal(organizationIdFromTrackUrl(""), null);
});

test("parseSpeedhiveSessionRef from speedhive event session URL", () => {
  const ref = parseSpeedhiveSessionRef(
    "https://speedhive.mylaps.com/events/100/sessions/200"
  );
  assert.ok(ref);
  assert.equal(ref.sessionId, 200);
  assert.equal(ref.eventId, 100);
  assert.match(ref.sessionUrl, /events\/100\/sessions\/200/);
});

test("parseSpeedhiveSessionRef from api2 session URL", () => {
  const ref = parseSpeedhiveSessionRef("https://api2.mylaps.com/sessions/555");
  assert.ok(ref);
  assert.equal(ref.sessionId, 555);
});

test("isSpeedhiveOrApiUrl recognizes api2 host", () => {
  assert.equal(isSpeedhiveOrApiUrl("https://api2.mylaps.com/sessions/1"), true);
});
