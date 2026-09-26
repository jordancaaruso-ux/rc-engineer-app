import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDriverSessionLabel,
  formatImportedSessionTime,
  importedSessionWeatherInstantIso,
  isWallClockAsUtcTimingSource,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
} from "./labels";

// LiveRC wall clock "4:36 PM" stored as-if-UTC by the parsers.
const WALL_CLOCK_AS_UTC_ISO = "2026-07-19T16:36:19.000Z";

test("wall-clock sources freeze in UTC (label matches the timing screen)", () => {
  for (const timingSource of ["liverc", "myrcm"] as const) {
    const label = formatImportedSessionTime(WALL_CLOCK_AS_UTC_ISO, {
      timingSource,
      displayTimeZone: "Australia/Sydney",
    });
    assert.equal(label, "19 Jul 2026, 4:36 PM", `${timingSource} should show the recorded wall clock`);
  }
});

test("true instants format in the viewer's zone (Speedhive)", () => {
  const label = formatImportedSessionTime(WALL_CLOCK_AS_UTC_ISO, {
    timingSource: "speedhive",
    displayTimeZone: "Australia/Sydney",
  });
  // 16:36 UTC = 02:36 AM next day in Sydney (AEST +10).
  assert.equal(label, "20 Jul 2026, 2:36 AM");
});

test("import-time fallback is a true instant even on LiveRC — no freeze", () => {
  const label = formatImportedSessionTime(WALL_CLOCK_AS_UTC_ISO, {
    timingSource: "liverc",
    isWallClockTime: false,
    displayTimeZone: "Australia/Sydney",
  });
  assert.equal(label, "20 Jul 2026, 2:36 AM");
});

test("a driver and a time read 'name · time'; a name that IS the time says it once", () => {
  const opts = { timingSource: "liverc" as const };
  assert.equal(formatDriverSessionLabel("Mark Mayhew", WALL_CLOCK_AS_UTC_ISO, opts), "Mark Mayhew · 19 Jul 2026, 4:36 PM");
  // Speedhive's practice import names each stint by its start time (test drive, 2026-09-26).
  assert.equal(formatDriverSessionLabel("19 Jul 2026, 4:36 PM", WALL_CLOCK_AS_UTC_ISO, opts), "19 Jul 2026, 4:36 PM");
  // A later stint of the same visit keeps its own start: it is not the session's time.
  assert.equal(
    formatDriverSessionLabel("19 Jul 2026, 4:52 PM", WALL_CLOCK_AS_UTC_ISO, opts),
    "19 Jul 2026, 4:52 PM · 19 Jul 2026, 4:36 PM"
  );
  assert.equal(formatDriverSessionLabel("  ", WALL_CLOCK_AS_UTC_ISO, opts), "Driver · 19 Jul 2026, 4:36 PM");
});

test("timing source detection", () => {
  assert.equal(timingSourceFromParserId("liverc_race_result_v2"), "liverc");
  assert.equal(timingSourceFromParserId("speedhive_practice_v1"), "speedhive");
  assert.equal(timingSourceFromParserId("myrcm_report_v1"), "myrcm");
  assert.equal(timingSourceFromParserId("http_timing_v1"), null);
  assert.equal(timingSourceFromSourceUrl("https://tftr.liverc.com/results/?p=view_race_result&id=1"), "liverc");
  assert.equal(timingSourceFromSourceUrl("https://myrcm.ch/myrcm/report/en/12345/67890"), "myrcm");
  assert.equal(timingSourceFromSourceUrl("https://speedhive.mylaps.com/practice/4591"), "speedhive");
  assert.equal(isWallClockAsUtcTimingSource("liverc"), true);
  assert.equal(isWallClockAsUtcTimingSource("myrcm"), true);
  assert.equal(isWallClockAsUtcTimingSource("speedhive"), false);
  assert.equal(isWallClockAsUtcTimingSource(null), false);
});

test("weather instant: LiveRC wall clock converts in the device zone", () => {
  const iso = importedSessionWeatherInstantIso(
    {
      sessionCompletedAt: "2026-08-30T15:59:06.000Z", // 3:59 PM on the track clock
      sessionCompletedAtIsWallClock: true,
      sourceUrl: "https://www.liverc.com/results/?p=view_race_result&id=1",
    },
    "Australia/Melbourne"
  );
  // AEST +10: the real instant is 05:59 UTC, not 15:59 UTC (which is 2 AM).
  assert.equal(iso, "2026-08-30T05:59:06.000Z");
});

test("weather instant: Speedhive practice instants pass through untouched", () => {
  const iso = importedSessionWeatherInstantIso(
    {
      sessionCompletedAt: "2026-08-30T05:59:06.000Z",
      sessionCompletedAtIsWallClock: true,
      sourceUrl: "https://speedhive.mylaps.com/practice/4591/activities/12",
    },
    "Australia/Melbourne"
  );
  assert.equal(iso, "2026-08-30T05:59:06.000Z");
});

test("weather instant: a Speedhive race result is the track's clock, converted like LiveRC", () => {
  const iso = importedSessionWeatherInstantIso(
    {
      sessionCompletedAt: "2026-08-30T15:59:06.000Z",
      sessionCompletedAtIsWallClock: true,
      sourceUrl: "https://speedhive.mylaps.com/Sessions/123",
    },
    "Australia/Melbourne"
  );
  assert.equal(iso, "2026-08-30T05:59:06.000Z");
});

test("a Speedhive race result freezes on the timing screen's clock once its address is given", () => {
  const label = formatImportedSessionTime(WALL_CLOCK_AS_UTC_ISO, {
    timingSource: "speedhive",
    sourceUrl: "https://speedhive.mylaps.com/events/3706689/sessions/5",
    displayTimeZone: "Australia/Sydney",
  });
  assert.equal(label, "19 Jul 2026, 4:36 PM");
});

test("weather instant: import-createdAt fallback is already real, passes through", () => {
  const iso = importedSessionWeatherInstantIso(
    {
      sessionCompletedAt: "2026-08-30T05:59:06.000Z",
      sessionCompletedAtIsWallClock: false,
      sourceUrl: "https://www.liverc.com/results/?p=view_race_result&id=1",
    },
    "Australia/Melbourne"
  );
  assert.equal(iso, "2026-08-30T05:59:06.000Z");
});

test("weather instant: wall clock with no device zone yields null (use current weather)", () => {
  const iso = importedSessionWeatherInstantIso(
    {
      sessionCompletedAt: "2026-08-30T15:59:06.000Z",
      sessionCompletedAtIsWallClock: true,
      sourceUrl: "https://www.liverc.com/results/?p=view_race_result&id=1",
    },
    null
  );
  assert.equal(iso, null);
});

test("weather instant: no session time yields null", () => {
  assert.equal(
    importedSessionWeatherInstantIso(
      { sessionCompletedAt: null, sessionCompletedAtIsWallClock: true, sourceUrl: null },
      "Australia/Melbourne"
    ),
    null
  );
  assert.equal(importedSessionWeatherInstantIso(null, "Australia/Melbourne"), null);
});
