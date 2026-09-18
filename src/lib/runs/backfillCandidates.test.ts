import test from "node:test";
import assert from "node:assert/strict";
import {
  chosenBackfillSessions,
  selectBackfillCandidates,
  timingSessionDayKey,
  withoutRunsOwnOutings,
  type BackfillCandidate,
} from "@/lib/runs/backfillCandidates";

test("the sheet's unticked sessions stay out, and a session the next scan adds is in by default", () => {
  const sessions = [{ sessionUrl: "https://t/s/2" }, { sessionUrl: "https://t/s/3" }, { sessionUrl: "https://t/s/4" }];
  assert.deepEqual(chosenBackfillSessions({ sessions }), sessions);
  assert.deepEqual(chosenBackfillSessions({ sessions, excludedUrls: [" https://t/s/3 "] }), [sessions[0], sessions[2]]);
  // A rescan that adds s/5 keeps the exclusion and lets the newcomer in.
  const grown = [...sessions, { sessionUrl: "https://t/s/5" }];
  assert.deepEqual(
    chosenBackfillSessions({ sessions: grown, excludedUrls: ["https://t/s/3"] }).map((s) => s.sessionUrl),
    ["https://t/s/2", "https://t/s/4", "https://t/s/5"]
  );
  assert.deepEqual(chosenBackfillSessions(null), []);
});

const TZ = "Australia/Melbourne";

test("LiveRC wall clock keys on its UTC date; Speedhive keys on the driver's zone", () => {
  // LiveRC stores 9:25 AM at the track as 09:25Z — the UTC date is the track's date.
  assert.equal(timingSessionDayKey("2026-09-12T09:25:00.000Z", "liverc", TZ), "2026-09-12");
  // Speedhive is a real instant: 22:30Z on the 12th is 8:30 AM on the 13th in Melbourne.
  assert.equal(timingSessionDayKey("2026-09-12T22:30:00.000Z", "speedhive", TZ), "2026-09-13");
  assert.equal(timingSessionDayKey("not a date", "liverc", TZ), null);
});

test("a day key comes off the track's clock where the session carries it, whatever the phone's zone", () => {
  const practice = { sessionUrl: "https://speedhive.mylaps.com/practice/4591/activities/9/sessions/1" };
  // The loop's +10:00 beside its instant: 8:30 AM on the 13th at the track, even read from LA.
  for (const phone of [TZ, "America/Los_Angeles", null]) {
    assert.equal(
      timingSessionDayKey("2026-09-12T22:30:00.000Z", "speedhive", phone, { ...practice, sessionUtcOffsetMinutes: 600 }),
      "2026-09-13"
    );
  }
  // A Speedhive race result prints the track's clock, like LiveRC: its UTC date is the day.
  const race = { sessionUrl: "https://speedhive.mylaps.com/events/3706689/sessions/5" };
  assert.equal(timingSessionDayKey("2026-09-13T23:10:00.000Z", "speedhive", "Asia/Tokyo", race), "2026-09-13");
});

test("offers the picked session's day, earlier and later, once per URL, earliest first", () => {
  const out = selectBackfillCandidates({
    picked: {
      sessionUrl: "https://liverc/s/4",
      sessionCompletedAtIso: "2026-09-12T11:00:00.000Z",
      timingSource: "liverc",
    },
    rows: [
      { sessionUrl: "https://liverc/s/4", sessionCompletedAtIso: "2026-09-12T11:00:00.000Z", timingSource: "liverc" },
      { sessionUrl: "https://liverc/s/2", sessionCompletedAtIso: "2026-09-12T09:30:00.000Z", timingSource: "liverc" },
      { sessionUrl: "https://liverc/s/5", sessionCompletedAtIso: "2026-09-12T12:10:00.000Z", timingSource: "liverc" },
      // Same URL twice: the copy carrying an import id wins whichever order they arrive in.
      { sessionUrl: "https://liverc/s/3", sessionCompletedAtIso: "2026-09-12T10:15:00.000Z", timingSource: "liverc" },
      {
        sessionUrl: "https://liverc/s/3",
        sessionCompletedAtIso: "2026-09-12T10:15:00.000Z",
        timingSource: "liverc",
        importedSessionId: "imp-3",
      },
      // Yesterday: not this day.
      { sessionUrl: "https://liverc/s/1", sessionCompletedAtIso: "2026-09-11T15:00:00.000Z", timingSource: "liverc" },
      // Already on a run.
      { sessionUrl: "https://liverc/s/6", sessionCompletedAtIso: "2026-09-12T13:00:00.000Z", timingSource: "liverc", linkedRunId: "run-6" },
      // No time: can't be placed in the day.
      { sessionUrl: "https://liverc/s/7", sessionCompletedAtIso: null, timingSource: "liverc" },
    ],
    attachedUrls: new Set(["https://liverc/s/4"]),
    timeZone: TZ,
  });
  assert.ok(out);
  assert.equal(out.dayKey, "2026-09-12");
  assert.deepEqual(
    out.sessions.map((s) => [s.sessionUrl, s.importedSessionId]),
    [
      ["https://liverc/s/2", null],
      ["https://liverc/s/3", "imp-3"],
      ["https://liverc/s/5", null],
    ]
  );
});

test("a Speedhive day is cut at the driver's midnight, not UTC's", () => {
  const out = selectBackfillCandidates({
    picked: {
      sessionUrl: "https://speedhive.mylaps.com/practice/4591/activities/1",
      sessionCompletedAtIso: "2026-09-12T23:00:00.000Z", // 9 AM 13th Melbourne
      timingSource: "speedhive",
    },
    rows: [
      { sessionUrl: "https://speedhive.mylaps.com/practice/4591/activities/2", sessionCompletedAtIso: "2026-09-13T01:00:00.000Z", timingSource: "speedhive" }, // 11 AM 13th
      { sessionUrl: "https://speedhive.mylaps.com/practice/4591/activities/0", sessionCompletedAtIso: "2026-09-12T08:00:00.000Z", timingSource: "speedhive" }, // 6 PM 12th
    ],
    attachedUrls: new Set(),
    timeZone: TZ,
  });
  assert.ok(out);
  assert.equal(out.dayKey, "2026-09-13");
  assert.deepEqual(out.sessions.map((s) => s.sessionUrl), ["https://speedhive.mylaps.com/practice/4591/activities/2"]);
});

test("nothing picked, or a picked session with no time, offers nothing", () => {
  assert.equal(
    selectBackfillCandidates({ picked: null, rows: [], attachedUrls: new Set(), timeZone: TZ }),
    null
  );
  assert.equal(
    selectBackfillCandidates({
      picked: { sessionUrl: "u", sessionCompletedAtIso: null, timingSource: "liverc" },
      rows: [{ sessionUrl: "v", sessionCompletedAtIso: "2026-09-12T09:00:00.000Z", timingSource: "liverc" }],
      attachedUrls: new Set(),
      timeZone: TZ,
    }),
    null
  );
});

test("the run's own race, posted again by a second site, is not offered as another run", () => {
  // The run: MyRCM's qualifier at a Sydney track, 10:36:37–10:47:08 on the track's clock.
  const runSpan = { start: new Date("2026-08-23T10:36:37.000Z"), end: new Date("2026-08-23T10:47:08.000Z") };
  const practice = (id: number, iso: string): BackfillCandidate => ({
    sessionUrl: `https://speedhive.mylaps.com/practice/4591/activities/${id}`,
    importedSessionId: null,
    sessionCompletedAtIso: iso,
    timingSource: "speedhive",
  });
  const sessions = [
    practice(2, "2026-08-23T00:36:40.000Z"), // the loop's copy of the same heat
    practice(3, "2026-08-23T03:10:00.000Z"), // the afternoon's practice, another run
    practice(4, "2026-08-23T00:40:00.000Z"), // no laps known: nothing to measure, so it stays
  ];
  const meta = (url: string) =>
    url.endsWith("/2")
      ? { lapCount: 27, bestLapSeconds: 22.858 }
      : url.endsWith("/3")
        ? { lapCount: 20, bestLapSeconds: 23.1 }
        : null;
  const kept = withoutRunsOwnOutings(sessions, meta, "Australia/Sydney", [runSpan]);
  assert.deepEqual(kept.map((s) => s.sessionUrl.split("/").pop()), ["3", "4"]);
  assert.equal(withoutRunsOwnOutings(sessions, meta, "Australia/Sydney", []).length, 3);

  // Logged from Los Angeles after the flight home: the loop's offset decides, not the phone.
  const withOffsets = sessions.map((s) => ({ ...s, sessionUtcOffsetMinutes: 600 }));
  const fromHome = withoutRunsOwnOutings(withOffsets, meta, "America/Los_Angeles", [runSpan]);
  assert.deepEqual(fromHome.map((s) => s.sessionUrl.split("/").pop()), ["3", "4"]);
});
