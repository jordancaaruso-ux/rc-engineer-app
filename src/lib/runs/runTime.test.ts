/**
 * When a run was on track: the stamps a run write chooses (`lib/runs/runTime.ts`), checked
 * against the test-drive cases of 2026-09-26.
 *
 *   npx tsx --test src/lib/runs/runTime.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  importedTimeIsOnTrack,
  ownSessionTime,
  parseRunAtIso,
  pastMeeting,
  pastMeetingDraftSortAt,
  readingIsForAnotherTime,
  runAtChangesRun,
  stampEditedRunTime,
  stampNewRunTime,
  withLoggingOrder,
  withTypedTrackTemp,
  type StoredRunTime,
} from "@/lib/runs/runTime";
import { NULL_RUN_CONDITIONS_COLUMNS } from "@/lib/weather/runConditionsRecord";

const NOW = new Date("2026-09-26T07:59:00.000Z"); // Sat 26 Sept, 2:59 am in Chicago
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

test("runAtIso: nothing picked is not an error", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.deepEqual(parseRunAtIso(raw, NOW), { ok: true, at: null });
  }
});

test("runAtIso: a past instant is taken as written, zone and all", () => {
  const utc = parseRunAtIso("2026-09-26T00:30:00.000Z", NOW);
  assert.equal(utc.ok && iso(utc.at), "2026-09-26T00:30:00.000Z");
  // Friday 7:30 pm in Chicago, written with its offset.
  const offset = parseRunAtIso("2026-09-25T19:30:00-05:00", NOW);
  assert.equal(offset.ok && iso(offset.at), "2026-09-26T00:30:00.000Z");
});

test("runAtIso: refuses what isn't an instant", () => {
  for (const raw of ["yesterday", "2026-09-25", "2026-09-25T19:30", "25/09/2026 19:30", 1758830000000, {}]) {
    const parsed = parseRunAtIso(raw, NOW);
    assert.equal(parsed.ok, false, String(raw));
  }
});

test("runAtIso: refuses before 2000 and more than an hour ahead", () => {
  assert.equal(parseRunAtIso("1999-12-31T23:59:59Z", NOW).ok, false);
  assert.equal(parseRunAtIso("2000-01-01T00:00:00Z", NOW).ok, true);
  assert.equal(parseRunAtIso("2026-09-26T09:00:00Z", NOW).ok, false, "61 minutes ahead");
});

test("runAtIso: a clock running a few minutes fast means now", () => {
  const parsed = parseRunAtIso("2026-09-26T08:20:00Z", NOW);
  assert.equal(parsed.ok && iso(parsed.at), iso(NOW));
});

test("logging order: the picked second stands, later typing sorts later", () => {
  const picked = new Date("2026-09-26T00:30:00.000Z");
  const first = withLoggingOrder(picked, new Date("2026-09-26T07:59:00Z"), "America/Chicago");
  const second = withLoggingOrder(picked, new Date("2026-09-26T08:04:00Z"), "America/Chicago");
  assert.ok(second.getTime() > first.getTime(), "typed five minutes later, sorts later");
  for (const d of [first, second]) {
    assert.equal(Math.floor(d.getTime() / 1000), picked.getTime() / 1000, "same second");
  }
  // A zone Intl refuses must not fail the save.
  assert.doesNotThrow(() => withLoggingOrder(picked, NOW, "Not/AZone"));
});

test("past meeting: a one-day meeting last Sunday files at midday on the track's clock", () => {
  // Stored the way the meeting form stores a day: UTC noon.
  const meeting = pastMeeting({
    startDate: new Date("2026-09-20T12:00:00.000Z"),
    endDate: new Date("2026-09-20T12:00:00.000Z"),
    zone: "America/New_York",
    now: NOW,
  });
  assert.equal(meeting?.firstDay, "2026-09-20");
  assert.equal(meeting?.lastDay, "2026-09-20");
  assert.equal(iso(meeting?.at), "2026-09-20T16:00:00.000Z", "noon EDT");
});

test("past meeting: a meeting on today, or still to come, is not past", () => {
  const today = new Date("2026-09-26T12:00:00.000Z");
  assert.equal(pastMeeting({ startDate: today, endDate: today, zone: "America/Chicago", now: NOW }), null);
  const nextWeek = new Date("2026-10-03T12:00:00.000Z");
  assert.equal(pastMeeting({ startDate: nextWeek, endDate: nextWeek, zone: "UTC", now: NOW }), null);
  // A weekend that started yesterday and runs today is on.
  const weekend = pastMeeting({
    startDate: new Date("2026-09-25T12:00:00.000Z"),
    endDate: new Date("2026-09-26T12:00:00.000Z"),
    zone: "Australia/Sydney",
    now: NOW,
  });
  assert.equal(weekend, null);
});

test("past meeting: the last day of a two-day meeting a year ago", () => {
  const meeting = pastMeeting({
    startDate: new Date("2025-09-06T12:00:00.000Z"),
    endDate: new Date("2025-09-07T12:00:00.000Z"),
    zone: "Europe/Berlin",
    now: NOW,
  });
  assert.equal(meeting?.firstDay, "2025-09-06");
  assert.equal(meeting?.lastDay, "2025-09-07");
  assert.equal(iso(meeting?.at), "2025-09-07T10:00:00.000Z", "noon CEST");
});

test("past meeting: a date stored as a real instant is read on the track's calendar", () => {
  // 13:00 UTC on the 19th is 1 am on the 20th in Auckland: the track's calendar decides.
  const meeting = pastMeeting({
    startDate: new Date("2026-09-19T13:00:00.000Z"),
    endDate: new Date("2026-09-19T13:00:00.000Z"),
    zone: "Pacific/Auckland",
    now: NOW,
  });
  assert.equal(meeting?.lastDay, "2026-09-20");
});

test("imported time: the moment of importing is not an on-track time", () => {
  const set = (flag: boolean | undefined) => ({
    isPrimaryUser: true,
    sessionCompletedAt: "2026-09-25T09:24:00.000Z",
    sessionCompletedAtIsWallClock: flag,
  });
  assert.equal(importedTimeIsOnTrack({ importedLapSets: [set(false)] }), false);
  assert.equal(importedTimeIsOnTrack({ importedLapSets: [set(true)] }), true);
  assert.equal(importedTimeIsOnTrack({ importedLapSets: [set(undefined)] }), true, "older clients");
  assert.equal(importedTimeIsOnTrack({}), true, "the session row's own time is parsed");
  // The primary driver's set decides, wherever it sits.
  assert.equal(
    importedTimeIsOnTrack({
      importedLapSets: [{ ...set(true), isPrimaryUser: false }, set(false)],
    }),
    false
  );
});

const LAST_NIGHT = new Date("2026-09-26T00:30:00.000Z"); // Fri 7:30 pm Chicago
const SUNDAY_MEETING = {
  firstDay: "2026-09-20",
  lastDay: "2026-09-20",
  at: new Date("2026-09-20T16:00:00.000Z"),
};

test("new run: a timing session's own clock files it (the August LiveRC race)", () => {
  const raceAt = new Date("2026-08-22T01:01:00.000Z");
  const stamped = stampNewRunTime({
    importedAt: raceAt,
    importedAtIsOnTrack: true,
    runAt: LAST_NIGHT,
    meeting: SUNDAY_MEETING,
  });
  assert.equal(iso(stamped.sortAt), iso(raceAt), "not the moment it was typed in");
  assert.equal(iso(stamped.sessionCompletedAt), iso(raceAt));
  assert.equal(stamped.weatherAt, raceAt);
});

test("new run: last night's practice typed in this morning files last night", () => {
  const stamped = stampNewRunTime({
    importedAt: null,
    importedAtIsOnTrack: true,
    runAt: LAST_NIGHT,
    meeting: null,
  });
  assert.equal(iso(stamped.sortAt), iso(LAST_NIGHT));
  assert.equal(iso(stamped.sessionCompletedAt), iso(LAST_NIGHT), "and shows last night");
  assert.equal(stamped.weatherAt, LAST_NIGHT);
});

test("new run: the racer's pick beats a time that is only when the laps were imported", () => {
  const importedWhen = new Date("2026-09-26T07:50:00.000Z");
  const stamped = stampNewRunTime({
    importedAt: importedWhen,
    importedAtIsOnTrack: false,
    runAt: LAST_NIGHT,
    meeting: null,
  });
  assert.equal(iso(stamped.sortAt), iso(LAST_NIGHT));
  // With no pick the import time is still what the run shows, as before, but it files nothing.
  const unpicked = stampNewRunTime({
    importedAt: importedWhen,
    importedAtIsOnTrack: false,
    runAt: null,
    meeting: null,
  });
  assert.equal(unpicked.sortAt, null);
  assert.equal(iso(unpicked.sessionCompletedAt), iso(importedWhen));
});

test("new run: a meeting that is over files on its last day, clock unknown", () => {
  const stamped = stampNewRunTime({
    importedAt: null,
    importedAtIsOnTrack: true,
    runAt: null,
    meeting: SUNDAY_MEETING,
  });
  assert.equal(iso(stamped.sortAt), iso(SUNDAY_MEETING.at));
  assert.equal(stamped.sessionCompletedAt, null, "the run still shows when it was logged");
  assert.equal(stamped.weatherAt, "unknown", "so no weather fetched now can describe it");
});

test("new run: nothing known is the moment of saving", () => {
  const stamped = stampNewRunTime({
    importedAt: null,
    importedAtIsOnTrack: true,
    runAt: null,
    meeting: null,
  });
  assert.deepEqual(stamped, { sortAt: null, sessionCompletedAt: null, weatherAt: null });
});

/** A run typed in at 2:58 am, saved at 2:59 am, no timing session. */
const STORED: StoredRunTime = {
  sortAt: new Date("2026-09-26T07:58:00.000Z"),
  sessionCompletedAt: null,
  createdAt: new Date("2026-09-26T07:58:00.000Z"),
  loggingCompletedAt: new Date("2026-09-26T07:59:00.000Z"),
  importedLapTimeSessionId: null,
};

test("edit: the time the run shows, sent back untouched, is no change", () => {
  // The run shows its logging time (2:59 am); an edit screen sends that minute back.
  assert.equal(runAtChangesRun(new Date("2026-09-26T07:59:00.000Z"), STORED), false);
  assert.equal(runAtChangesRun(new Date("2026-09-26T07:58:30.000Z"), STORED), false, "its sortAt");
  assert.equal(runAtChangesRun(LAST_NIGHT, STORED), true);
});

test("edit: a new pick moves the day and the time together", () => {
  const edited = stampEditedRunTime({
    stored: STORED,
    importedAt: null,
    importedAtIsOnTrack: true,
    runAt: LAST_NIGHT,
  });
  assert.equal(iso(edited.moveTo), iso(LAST_NIGHT));
  assert.equal(iso(edited.sessionCompletedAt), iso(LAST_NIGHT));
});

test("edit: a timing sheet's time is never overridden by a pick", () => {
  const sheet = new Date("2026-09-25T23:15:00.000Z");
  const edited = stampEditedRunTime({
    stored: { ...STORED, sessionCompletedAt: sheet, importedLapTimeSessionId: "s1" },
    importedAt: sheet,
    importedAtIsOnTrack: true,
    runAt: LAST_NIGHT,
  });
  assert.equal(edited.moveTo, null);
  assert.equal(iso(edited.sessionCompletedAt), iso(sheet));
});

test("edit: a save that says nothing about time keeps the racer's earlier pick", () => {
  const picked: StoredRunTime = { ...STORED, sortAt: LAST_NIGHT, sessionCompletedAt: LAST_NIGHT };
  assert.equal(iso(ownSessionTime(picked)), iso(LAST_NIGHT));
  for (const runAt of [null, LAST_NIGHT]) {
    const edited = stampEditedRunTime({
      stored: picked,
      importedAt: null,
      importedAtIsOnTrack: true,
      runAt,
    });
    assert.equal(edited.moveTo, null);
    assert.equal(iso(edited.sessionCompletedAt), iso(LAST_NIGHT), "not wiped");
  }
});

test("edit: a timing sheet's time is not the run's own, so detaching laps still clears it", () => {
  const sheet = new Date("2026-09-25T23:15:00.000Z");
  const fromSheet: StoredRunTime = {
    ...STORED,
    sortAt: sheet,
    sessionCompletedAt: sheet,
    importedLapTimeSessionId: "s1",
  };
  assert.equal(ownSessionTime(fromSheet), null);
  assert.equal(ownSessionTime({ ...STORED, sessionCompletedAt: sheet }), null, "not the filing time");
});

test("finished draft after its meeting: a meeting-day stamp stays, any other goes to the last day", () => {
  const meeting = {
    firstDay: "2026-09-19",
    lastDay: "2026-09-20",
    at: new Date("2026-09-20T02:00:00.000Z"),
  };
  const zone = "Australia/Sydney";
  // Saved at the track on the Saturday morning.
  assert.equal(pastMeetingDraftSortAt(new Date("2026-09-18T23:30:00.000Z"), meeting, zone), null);
  // Prepped the Thursday night before.
  assert.equal(
    iso(pastMeetingDraftSortAt(new Date("2026-09-17T10:00:00.000Z"), meeting, zone)),
    iso(meeting.at)
  );
});

test("weather: a reading fetched for this morning doesn't describe last night", () => {
  const fetchedNow = {
    conditionsSource: "open-meteo-forecast",
    conditionsObservedAt: new Date("2026-09-26T07:00:00.000Z"),
  };
  assert.equal(readingIsForAnotherTime(fetchedNow, LAST_NIGHT), true);
  assert.equal(readingIsForAnotherTime(fetchedNow, new Date("2026-09-26T06:10:00.000Z")), false);
  assert.equal(readingIsForAnotherTime(fetchedNow, null), false, "logged now: it is now's");
  assert.equal(readingIsForAnotherTime(fetchedNow, "unknown"), true, "no clock: nothing fetched fits");
  assert.equal(
    readingIsForAnotherTime({ ...fetchedNow, conditionsSource: "manual" }, LAST_NIGHT),
    false,
    "typed by the racer"
  );
  assert.equal(
    readingIsForAnotherTime({ ...fetchedNow, conditionsObservedAt: null }, LAST_NIGHT),
    false,
    "can't be judged"
  );
});

test("weather: a typed probe track temp survives a dropped reading", () => {
  assert.equal(withTypedTrackTemp(null, null), null);
  const alone = withTypedTrackTemp(NULL_RUN_CONDITIONS_COLUMNS, 31);
  assert.equal(alone?.conditionsTrackTempC, 31);
  assert.equal(alone?.conditionsSource, "manual");
  const fetched = withTypedTrackTemp(
    { ...NULL_RUN_CONDITIONS_COLUMNS, conditionsAirTempC: 17, conditionsSource: "open-meteo-archive" },
    31
  );
  assert.equal(fetched?.conditionsSource, "open-meteo-archive");
  assert.equal(fetched?.conditionsAirTempC, 17);
  assert.equal(fetched?.conditionsTrackTempC, 31);
});
