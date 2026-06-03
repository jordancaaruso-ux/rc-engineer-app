/**
 * Run: `npx tsx src/lib/speedhive/speedhiveUrl.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
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
    assert.equal(v.organizationId, 4242);
    assert.match(v.normalized, /organizations\/4242/i);
  }
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
