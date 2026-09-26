/**
 * Run: `npx tsx src/lib/speedhive/speedhiveUrl.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSpeedhivePracticeLocationPageUrl,
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

test("parseSpeedhivePracticeActivityRef reads the link Speedhive's site gives out now", () => {
  // Every session on a club's practice page links as /practice/<activityId>/activity. Pasted, it
  // matched none of the location-first shapes and failed as "no lap-shaped numbers" (2026-09-26).
  const ref = parseSpeedhivePracticeActivityRef(
    "https://speedhive.mylaps.com/practice/8354099722/activity"
  );
  assert.ok(ref);
  assert.equal(ref.activityId, 8354099722);
  assert.equal(ref.locationId, null, "the link names the visit only; the practice API has its track");
  assert.equal(ref.trainingSessionId, undefined);
  assert.equal(ref.sessionUrl, "https://speedhive.mylaps.com/practice/8354099722/activity");

  // A trailing slash, a language prefix or a query string is the same link.
  for (const url of [
    "https://speedhive.mylaps.com/practice/8356996093/activity/",
    "https://speedhive.mylaps.com/nl/practice/8356996093/activity?utm=share",
  ]) {
    assert.equal(parseSpeedhivePracticeActivityRef(url)?.activityId, 8356996093, url);
  }
});

test("the location-first practice links read as before", () => {
  const cases: Array<[string, number, number, number | undefined]> = [
    ["https://speedhive.mylaps.com/practice/3472/activities/8354099722", 3472, 8354099722, undefined],
    ["https://speedhive.mylaps.com/practice/3472/activity/8354099722", 3472, 8354099722, undefined],
    ["https://speedhive.mylaps.com/practice/3472/activities/8354099722/sessions/1", 3472, 8354099722, 1],
  ];
  for (const [url, locationId, activityId, trainingSessionId] of cases) {
    const ref = parseSpeedhivePracticeActivityRef(url);
    assert.equal(ref?.locationId, locationId, url);
    assert.equal(ref?.activityId, activityId, url);
    assert.equal(ref?.trainingSessionId, trainingSessionId, url);
  }
});

test("a club's practice page is not one session", () => {
  assert.equal(parseSpeedhivePracticeActivityRef("https://speedhive.mylaps.com/practice/3472"), null);
  assert.equal(isSpeedhivePracticeLocationPageUrl("https://speedhive.mylaps.com/practice/3472"), true);
  assert.equal(isSpeedhivePracticeLocationPageUrl("https://speedhive.mylaps.com/practice/3472/"), true);
  assert.equal(
    isSpeedhivePracticeLocationPageUrl("https://speedhive.mylaps.com/practice/8354099722/activity"),
    false
  );
  assert.equal(isSpeedhivePracticeLocationPageUrl("https://example.com/practice/3472"), false);
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
