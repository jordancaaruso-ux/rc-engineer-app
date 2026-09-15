import test from "node:test";
import assert from "node:assert/strict";
import {
  chosenBackfillSessions,
  selectBackfillCandidates,
  timingSessionDayKey,
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
      sessionUrl: "https://speedhive/a/1",
      sessionCompletedAtIso: "2026-09-12T23:00:00.000Z", // 9 AM 13th Melbourne
      timingSource: "speedhive",
    },
    rows: [
      { sessionUrl: "https://speedhive/a/2", sessionCompletedAtIso: "2026-09-13T01:00:00.000Z", timingSource: "speedhive" }, // 11 AM 13th
      { sessionUrl: "https://speedhive/a/0", sessionCompletedAtIso: "2026-09-12T08:00:00.000Z", timingSource: "speedhive" }, // 6 PM 12th
    ],
    attachedUrls: new Set(),
    timeZone: TZ,
  });
  assert.ok(out);
  assert.equal(out.dayKey, "2026-09-13");
  assert.deepEqual(out.sessions.map((s) => s.sessionUrl), ["https://speedhive/a/2"]);
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
