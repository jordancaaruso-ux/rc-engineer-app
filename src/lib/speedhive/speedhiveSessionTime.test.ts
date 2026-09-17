import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { speedhiveSessionInstant, speedhiveSessionLocalYmd } from "@/lib/speedhive/speedhiveSessionTime";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

test("a zone-less session time's date is the track's date, whatever the server's zone", () => {
  for (const serverZone of ["UTC", "Australia/Sydney", "America/Los_Angeles"]) {
    process.env.TZ = serverZone;
    // An afternoon heat in Tokyo used to move to the next day once read back in the track's zone.
    assert.equal(speedhiveSessionLocalYmd("2026-09-13T16:30:00", "Asia/Tokyo"), "2026-09-13", serverZone);
    assert.equal(speedhiveSessionLocalYmd("2026-09-13T10:11:00", "Australia/Adelaide"), "2026-09-13", serverZone);
  }
});

test("a zone-less session time becomes the instant it was at the track", () => {
  process.env.TZ = "Australia/Sydney";
  assert.equal(speedhiveSessionInstant("2026-09-13T10:11:00", "Asia/Tokyo")?.toISOString(), "2026-09-13T01:11:00.000Z");
  assert.equal(
    speedhiveSessionInstant("2026-09-12T11:38:00", "Australia/Adelaide")?.toISOString(),
    "2026-09-12T02:08:00.000Z",
  );
});

test("a time that names its zone is already an instant", () => {
  assert.equal(speedhiveSessionInstant("2026-09-13T01:11:00Z", "Asia/Tokyo")?.toISOString(), "2026-09-13T01:11:00.000Z");
  assert.equal(speedhiveSessionLocalYmd("2026-09-13T15:30:00Z", "Asia/Tokyo"), "2026-09-14");
});

test("no time, no answer", () => {
  assert.equal(speedhiveSessionLocalYmd(null, "Asia/Tokyo"), null);
  assert.equal(speedhiveSessionInstant("", "Asia/Tokyo"), null);
  assert.equal(speedhiveSessionInstant("not a time", "Asia/Tokyo"), null);
});
