import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  speedhivePracticeUtcOffsetMinutes,
  speedhiveSessionLocalYmd,
  speedhiveSessionWallClockIso,
} from "@/lib/speedhive/speedhiveSessionTime";

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

test("a zone-less session time is kept as the track's clock as-if-UTC, whatever the server's zone", () => {
  for (const serverZone of ["UTC", "Australia/Sydney", "America/Los_Angeles"]) {
    process.env.TZ = serverZone;
    assert.equal(speedhiveSessionWallClockIso("2026-09-13T10:11:00"), "2026-09-13T10:11:00.000Z", serverZone);
    assert.equal(speedhiveSessionWallClockIso("2026-09-12T11:38"), "2026-09-12T11:38:00.000Z", serverZone);
  }
});

test("a time that spells out a zone keeps its wall-clock digits", () => {
  assert.equal(speedhiveSessionWallClockIso("2026-09-13T10:11:00+09:00"), "2026-09-13T10:11:00.000Z");
  assert.equal(speedhiveSessionWallClockIso("2026-09-13T01:11:00Z"), "2026-09-13T01:11:00.000Z");
  assert.equal(speedhiveSessionLocalYmd("2026-09-13T15:30:00Z", "Asia/Tokyo"), "2026-09-14");
});

test("the practice loop's offset comes off the run's start, else any lap", () => {
  assert.equal(
    speedhivePracticeUtcOffsetMinutes([{ dateTimeStart: "2026-09-16T12:37:34.844+02:00", laps: [] }]),
    120
  );
  assert.equal(
    speedhivePracticeUtcOffsetMinutes([
      { dateTimeStart: undefined, laps: [{ dateTimeStart: undefined }, { dateTimeStart: "2026-08-23T10:37:04+10:00" }] },
    ]),
    600
  );
  assert.equal(speedhivePracticeUtcOffsetMinutes([{ dateTimeStart: "2026-09-16T10:37:34Z", laps: null }]), null);
  assert.equal(speedhivePracticeUtcOffsetMinutes([]), null);
});

test("no time, no answer", () => {
  assert.equal(speedhiveSessionLocalYmd(null, "Asia/Tokyo"), null);
  assert.equal(speedhiveSessionWallClockIso(""), null);
  assert.equal(speedhiveSessionWallClockIso("not a time"), null);
  assert.equal(speedhiveSessionWallClockIso(null), null);
});
