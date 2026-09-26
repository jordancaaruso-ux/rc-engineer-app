/**
 * Run: `npx tsx --test src/lib/lapImport/trackClock.test.ts`
 *
 * Every timing site posts the track's own clock (checked live 2026-09-17); these pin down reading
 * it from each one, and that the phone's zone only matters for a practice import with no offset.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  importedSessionTimeForDisplay,
  importedSessionTimeIsTrackClock,
  isSpeedhiveRaceResultSession,
  isWallClockAsUtcTimingSource,
} from "@/lib/lapImport/labels";
import {
  isDateOnlyTrackTime,
  trackClockDayKey,
  trackClockTime,
  utcOffsetMinutesFromIso,
} from "@/lib/lapImport/trackClock";
import { instantToWallClockAsUtc, utcOffsetMinutesInZone, wallClockAsUtcToInstant } from "@/lib/eventActive";

const MYRCM_PDF = "myrcm-pdf://0123456789abcdef/report-96077-1.pdf";
const LIVERC_RACE = "https://club.liverc.com/results/?p=view_race_result&id=77";
const SPEEDHIVE_PRACTICE = "https://speedhive.mylaps.com/practice/4591/activities/12/sessions/3";
const SPEEDHIVE_RACE = "https://speedhive.mylaps.com/events/3671358/sessions/77";

test("an offset spelled out on a timestamp is read; a zoneless or UTC one says nothing", () => {
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T12:37:34.844+02:00"), 120);
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T12:37:34+10:00"), 600);
  assert.equal(utcOffsetMinutesFromIso("2026-01-10T09:00:00+10:30"), 630);
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T05:37:34-0700"), -420);
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T12:37:34"), null);
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T10:37:34.844Z"), null);
  assert.equal(utcOffsetMinutesFromIso("2026-09-16T12:37:34+23:00"), null);
  assert.equal(utcOffsetMinutesFromIso(""), null);
  assert.equal(utcOffsetMinutesFromIso(null), null);
});

test("Speedhive's race results are told from its practice loop", () => {
  assert.equal(isSpeedhiveRaceResultSession({ parserId: "speedhive_api_v1" }), true);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: SPEEDHIVE_RACE }), true);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: "https://api2.mylaps.com/sessions/77" }), true);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: "https://speedhive.mylaps.com/Sessions/123" }), true);
  assert.equal(isSpeedhiveRaceResultSession({ parserId: "speedhive_practice_v1", sourceUrl: SPEEDHIVE_RACE }), false);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: SPEEDHIVE_PRACTICE }), false);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: "https://speedhive.mylaps.com/practice/4591" }), false);
  assert.equal(isSpeedhiveRaceResultSession({ sourceUrl: LIVERC_RACE }), false);
  assert.equal(isSpeedhiveRaceResultSession(null), false);

  assert.equal(isWallClockAsUtcTimingSource("speedhive", { sourceUrl: SPEEDHIVE_RACE }), true);
  assert.equal(isWallClockAsUtcTimingSource("speedhive", { sourceUrl: SPEEDHIVE_PRACTICE }), false);
  // Without the session, a Speedhive time stays a real instant, as it always was.
  assert.equal(isWallClockAsUtcTimingSource("speedhive"), false);
});

test("the same heat reads one track time on every site, and no zone is asked", () => {
  const onTrack = "2026-08-23T10:36:37.000Z";
  assert.equal(trackClockTime({ iso: onTrack, sourceUrl: MYRCM_PDF, parserId: "myrcm-pdf" })?.toISOString(), onTrack);
  assert.equal(trackClockTime({ iso: onTrack, sourceUrl: LIVERC_RACE })?.toISOString(), onTrack);
  assert.equal(trackClockTime({ iso: onTrack, sourceUrl: SPEEDHIVE_RACE })?.toISOString(), onTrack);
  // The practice loop's real instant, with the track's +10:00 beside it — whatever the phone says.
  for (const fallbackTimeZone of [null, "America/Los_Angeles", "Europe/London"]) {
    assert.equal(
      trackClockTime({
        iso: "2026-08-23T00:36:37.000Z",
        sourceUrl: SPEEDHIVE_PRACTICE,
        utcOffsetMinutes: 600,
        fallbackTimeZone,
      })?.toISOString(),
      onTrack
    );
  }
});

test("a practice time with no offset is read in the fallback zone, else left as it is", () => {
  const real = "2026-08-23T00:36:37.000Z";
  assert.equal(
    trackClockTime({ iso: real, sourceUrl: SPEEDHIVE_PRACTICE, fallbackTimeZone: "Australia/Sydney" })?.toISOString(),
    "2026-08-23T10:36:37.000Z"
  );
  assert.equal(trackClockTime({ iso: real, sourceUrl: SPEEDHIVE_PRACTICE })?.toISOString(), real);
  assert.equal(
    trackClockTime({ iso: real, sourceUrl: SPEEDHIVE_PRACTICE, fallbackTimeZone: "Not/AZone" })?.toISOString(),
    real
  );
});

test("the track's day comes off its clock: an evening heat stays on its own date", () => {
  // 9:30 pm on the 13th in Melbourne is 11:30 UTC; the practice loop's copy dates the same.
  assert.equal(trackClockDayKey({ iso: "2026-09-13T21:30:00.000Z", sourceUrl: LIVERC_RACE }), "2026-09-13");
  assert.equal(
    trackClockDayKey({ iso: "2026-09-13T11:30:00.000Z", sourceUrl: SPEEDHIVE_PRACTICE, utcOffsetMinutes: 600 }),
    "2026-09-13"
  );
});

test("no time, no answer", () => {
  assert.equal(trackClockTime({ iso: null, sourceUrl: LIVERC_RACE }), null);
  assert.equal(trackClockTime({ iso: "not a time", sourceUrl: LIVERC_RACE }), null);
  assert.equal(trackClockDayKey({ iso: "", sourceUrl: LIVERC_RACE }), null);
});

test("the zone conversions round-trip and name the offset, across daylight saving", () => {
  for (const [zone, real, offset] of [
    ["Australia/Sydney", "2026-07-19T06:36:19.000Z", 600],
    ["Australia/Sydney", "2026-01-10T06:36:19.000Z", 660],
    ["America/Los_Angeles", "2026-07-19T16:36:19.000Z", -420],
    ["Asia/Kolkata", "2026-07-19T04:06:19.000Z", 330],
  ] as const) {
    const at = new Date(real);
    assert.equal(utcOffsetMinutesInZone(zone, at), offset, zone);
    const wall = instantToWallClockAsUtc(at, zone);
    assert.equal(wall.getTime() - at.getTime(), offset * 60_000, zone);
    assert.equal(wallClockAsUtcToInstant(wall, zone).toISOString(), real, zone);
  }
  // Milliseconds on the instant stay exact one way (the practice loop's are real).
  const withMs = new Date("2026-09-16T10:37:34.844Z");
  assert.equal(instantToWallClockAsUtc(withMs, "Europe/Berlin").toISOString(), "2026-09-16T12:37:34.844Z");
});

/**
 * Founder ruling 2026-09-18: a session's time is shown on the EVENT's clock, and only the time
 * it was imported on the device's. `importedSessionTimeForDisplay` is what the screens call.
 */
test("a session's time is shown on the track's clock, whatever the viewer's zone", () => {
  // Speedhive practice: a true instant plus the track's offset (central Europe, +2 in October).
  // This is the row that started it — it read 10:03 PM in Melbourne for a 1:03 pm run at MR33.
  const practice = importedSessionTimeForDisplay("2025-10-12T11:03:29.558Z", {
    timingSource: "speedhive",
    sourceUrl: SPEEDHIVE_PRACTICE,
    parserId: "speedhive_practice_v1",
    utcOffsetMinutes: 120,
    displayTimeZone: "Australia/Melbourne",
  });
  assert.equal(practice.iso, "2025-10-12T13:03:29.558Z");
  assert.equal(practice.timeZone, "UTC");

  // LiveRC already stores the track's digits as-if-UTC: read them back literally, don't shift.
  const race = importedSessionTimeForDisplay("2026-09-12T14:27:00.000Z", {
    timingSource: "liverc",
    sourceUrl: LIVERC_RACE,
    displayTimeZone: "Australia/Melbourne",
  });
  assert.equal(race.iso, "2026-09-12T14:27:00.000Z");
  assert.equal(race.timeZone, "UTC");
});

test("an import-time fallback stays on the viewer's clock and claims no track", () => {
  // `isWallClockTime: false` says the ISO is an import row's createdAt, not a session time.
  const opts = {
    timingSource: "liverc" as const,
    sourceUrl: LIVERC_RACE,
    isWallClockTime: false,
    displayTimeZone: "Australia/Melbourne",
  };
  assert.equal(importedSessionTimeIsTrackClock(opts), false);
  const shown = importedSessionTimeForDisplay("2026-09-16T05:15:00.000Z", opts);
  assert.equal(shown.iso, "2026-09-16T05:15:00.000Z");
  assert.equal(shown.timeZone, "Australia/Melbourne");
});

test("a true instant with no offset on file cannot claim the track's clock", () => {
  // Speedhive practice imported before offsets were kept: honest fallback to the viewer's zone.
  const opts = {
    timingSource: "speedhive" as const,
    sourceUrl: SPEEDHIVE_PRACTICE,
    parserId: "speedhive_practice_v1",
    displayTimeZone: "Australia/Melbourne",
  };
  assert.equal(importedSessionTimeIsTrackClock(opts), false);
  assert.equal(importedSessionTimeForDisplay("2025-10-12T11:03:29.558Z", opts).timeZone, "Australia/Melbourne");
});

test("a nonsense offset is refused rather than shifting the clock by days", () => {
  const opts = {
    timingSource: "speedhive" as const,
    sourceUrl: SPEEDHIVE_PRACTICE,
    parserId: "speedhive_practice_v1",
    utcOffsetMinutes: 99_999,
  };
  assert.equal(importedSessionTimeIsTrackClock(opts), false);
});

test("a date with no clock is told from a real time", () => {
  // A LiveRC race page prints only the meeting's date; stored as that day's midnight, it read as a
  // real "12:00 am" and every race of the day sat at the same instant (test drive, 2026-09-26).
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T00:00:00.000Z", sourceUrl: LIVERC_RACE }), true);
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T00:00:00.000Z", sourceUrl: MYRCM_PDF }), true);
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T00:00:00.000Z", parserId: "liverc_race_result_v1" }), true);
  // A real clock, even one a minute past midnight, is a time.
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T14:23:00.000Z", sourceUrl: LIVERC_RACE }), false);
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T00:01:00.000Z", sourceUrl: LIVERC_RACE }), false);
  // A true instant (Speedhive practice) at UTC midnight is a real moment, not a bare date.
  assert.equal(isDateOnlyTrackTime({ iso: "2026-09-13T00:00:00.000Z", sourceUrl: SPEEDHIVE_PRACTICE }), false);
  assert.equal(isDateOnlyTrackTime({ iso: null, sourceUrl: LIVERC_RACE }), false);
  assert.equal(isDateOnlyTrackTime({ iso: "not a date", sourceUrl: LIVERC_RACE }), false);
});
