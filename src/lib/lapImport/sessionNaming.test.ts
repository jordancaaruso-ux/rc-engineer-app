import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNamedSessions, nameImportedSessions, type SessionNamingRow } from "@/lib/lapImport/sessionNaming";
import { MYRCM_PDF_SOURCE_PREFIX } from "@/lib/lapUrlParsers/myRcmPdfSource";

const NOW = new Date("2026-09-23T10:00:00.000Z");
const viewer = {
  names: ["Jordan Caruso\nJ Caruso"],
  displayName: "Jordan Caruso",
  transponders: ["4412087"],
  saved: [{ name: "Tim", transponder: "7281046" }],
};

function practice(id: string, driver: string, wallClockIso: string, extra: Partial<SessionNamingRow> = {}): SessionNamingRow {
  return {
    id,
    createdAt: "2026-09-22T12:00:00.000Z",
    // LiveRC stores the track's own clock written as UTC.
    sessionCompletedAt: wallClockIso,
    sourceUrl: `https://chargersrc.liverc.com/practice/?p=view_session&id=${id}`,
    parserId: "liverc_practice_session_v1",
    parsedPayload: {
      sessionDrivers: [{ driverName: driver, laps: [13.5, 13.4, 13.6] }],
      sessionHint: { name: null, className: "13.5 Touring" },
    },
    trackName: "Chargers RC",
    ...extra,
  };
}

function race(id: string, drivers: string[], wallClockIso: string, raceName: string): SessionNamingRow {
  return {
    id,
    createdAt: "2026-09-22T12:00:00.000Z",
    sessionCompletedAt: wallClockIso,
    sourceUrl: `https://chargersrc.liverc.com/results/?p=view_race_result&id=${id}`,
    parserId: "liverc_race_result_v1",
    parsedPayload: {
      sessionDrivers: drivers.map((driverName) => ({ driverName, laps: [14.1, 14.0] })),
      sessionHint: { name: null, className: raceName },
    },
    trackName: "Chargers RC",
  };
}

const opts = { timeZone: "Australia/Melbourne", now: NOW };

test("the viewer's practice reads name · Run N, numbered by time on track", () => {
  const names = nameImportedSessions(
    [
      practice("c", "Jordan Caruso", "2026-09-22T19:48:00.000Z"),
      practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("b", "JORDAN CARUSO", "2026-09-22T19:21:00.000Z"),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("a")?.title, "Jordan Caruso · Run 1");
  assert.equal(names.get("b")?.title, "Jordan Caruso · Run 2");
  assert.equal(names.get("c")?.title, "Jordan Caruso · Run 3");
  assert.equal(names.get("c")?.timeLabel, "7:48 PM");
  assert.match(names.get("c")?.groupLabel ?? "", /^Tue 22 Sept? · Chargers RC$/);
  assert.equal(names.get("c")?.isViewer, true);
  assert.equal(names.get("c")?.detail, null);
});

test("the class a practice sheet prints is never the name", () => {
  const n = nameImportedSessions([practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z")], viewer, opts).get("a");
  assert.ok(!n?.title.includes("13.5 Touring"));
});

test("a rival's practice is numbered in their own day, not the viewer's", () => {
  const names = nameImportedSessions(
    [
      practice("mine1", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("alex", "Alex Chen", "2026-09-22T19:05:00.000Z"),
      practice("mine2", "Jordan Caruso", "2026-09-22T19:21:00.000Z"),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("alex")?.title, "Alex Chen · Run 1");
  assert.equal(names.get("mine2")?.title, "Jordan Caruso · Run 2");
  assert.equal(names.get("alex")?.isViewer, false);
});

test("a race keeps its own name; the viewer's race leads with their name and takes a place in the day", () => {
  const names = nameImportedSessions(
    [
      practice("p1", "Jordan Caruso", "2026-09-20T09:00:00.000Z"),
      race("q2", ["Sam Other", "Jordan Caruso", "Lee Third"], "2026-09-20T10:30:00.000Z", "ISTC 13.5 Qualifier 2"),
      practice("p2", "Jordan Caruso", "2026-09-20T12:00:00.000Z"),
      race("main", ["Sam Other", "Lee Third"], "2026-09-20T16:10:00.000Z", "ISTC Modified A3-Main"),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("q2")?.title, "Jordan Caruso · ISTC 13.5 Qualifier 2");
  assert.equal(names.get("q2")?.runNumber, null);
  assert.equal(names.get("q2")?.detail, "3 drivers");
  assert.equal(names.get("p2")?.title, "Jordan Caruso · Run 3");
  assert.equal(names.get("main")?.title, "ISTC Modified A3-Main");
  assert.equal(names.get("main")?.who, null);
  assert.equal(names.get("main")?.detail, "2 drivers");
});

test("a name the driver typed wins, and the automatic one is kept", () => {
  const n = nameImportedSessions(
    [practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z", { customName: "  Diff oil test  " })],
    viewer,
    opts
  ).get("a");
  assert.equal(n?.title, "Diff oil test");
  assert.equal(n?.autoTitle, "Jordan Caruso · Run 1");
  assert.equal(n?.isCustom, true);
});

test("deleted sessions passed in still hold their run number for the rest of the day", () => {
  // The loader passes the whole day, hidden rows included; only "a" and "c" are shown.
  const names = nameImportedSessions(
    [
      practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("b-deleted", "Jordan Caruso", "2026-09-22T19:21:00.000Z"),
      practice("c", "Jordan Caruso", "2026-09-22T19:48:00.000Z"),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("c")?.title, "Jordan Caruso · Run 3");
});

test("the same outing on a second timing site shares its number", () => {
  const copy = practice("copy", "Jordan Caruso", "2026-09-22T19:22:00.000Z", {
    sourceUrl: "https://chargersrc.liverc.com/practice/?p=view_session&id=copy2",
  });
  const names = nameImportedSessions(
    [
      practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("b", "Jordan Caruso", "2026-09-22T19:21:00.000Z"),
      copy,
      practice("c", "Jordan Caruso", "2026-09-22T19:48:00.000Z"),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("copy")?.runNumber, 2);
  assert.equal(names.get("c")?.runNumber, 3);
});

test("MyRCM keeps the session name and puts the class on the second line", () => {
  const n = nameImportedSessions(
    [
      {
        id: "pdf",
        createdAt: "2026-08-27T12:02:00.000Z",
        sessionCompletedAt: "2026-08-09T11:00:00.000Z",
        sourceUrl: `${MYRCM_PDF_SOURCE_PREFIX}abc123/heat25.pdf`,
        parserId: "myrcm-pdf",
        parsedPayload: {
          sessionDrivers: Array.from({ length: 11 }, (_, i) => ({ driverName: `Driver ${i}`, laps: [20.1] })),
          sessionHint: { name: "Heat 25 Qualy 2", className: "Awesomatix Pro Stock" },
        },
      },
    ],
    viewer,
    opts
  ).get("pdf");
  assert.equal(n?.title, "Heat 25 Qualy 2");
  assert.equal(n?.detail, "Awesomatix Pro Stock · 11 drivers");
  assert.equal(n?.place, "MyRCM");
});

test("MYLAPS practice: a saved chip name, else the number — never the time it prints as a name", () => {
  const mylaps = (id: string, chip: string | null): SessionNamingRow => ({
    id,
    createdAt: "2026-09-21T01:00:00.000Z",
    sessionCompletedAt: "2026-09-21T00:12:00.000Z",
    sourceUrl: `https://speedhive.mylaps.com/practice/4591/activities/${id}`,
    parserId: "speedhive_practice_v1",
    parsedPayload: {
      sessionDrivers: [{ driverName: "21/09/2026, 10:12 am", laps: [16.2, 16.1] }],
      sessionHint: chip ? { name: null, practiceTransponder: chip } : { name: null },
      sessionUtcOffsetMinutes: 600,
    },
    trackName: "MR33 Arena",
  });
  const names = nameImportedSessions([mylaps("111", "7281046"), mylaps("222", "5550001")], viewer, opts);
  assert.equal(names.get("111")?.title, "Tim · Run 1");
  assert.equal(names.get("222")?.title, "Transponder 5550001 · Run 1");
  assert.equal(names.get("111")?.timeLabel, "10:12 AM");
});

test("a session the sweep found by the viewer's own chip is the viewer's", () => {
  const n = nameImportedSessions(
    [
      {
        id: "sw",
        createdAt: "2026-09-21T01:00:00.000Z",
        sessionCompletedAt: "2026-09-21T00:12:00.000Z",
        sourceUrl: "https://speedhive.mylaps.com/practice/4591/activities/333",
        parserId: "speedhive_practice_v1",
        parsedPayload: {
          sessionDrivers: [{ driverName: "21/09/2026, 10:12 am", laps: [16.2] }],
          sessionUtcOffsetMinutes: 600,
        },
        sweepChipCode: "4412087",
      },
    ],
    viewer,
    opts
  ).get("sw");
  assert.equal(n?.title, "Jordan Caruso · Run 1");
  assert.equal(n?.place, "MYLAPS");
});

test("no matched track: the timing site stands in for the place", () => {
  const n = nameImportedSessions(
    [practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z", { trackName: null })],
    viewer,
    opts
  ).get("a");
  assert.equal(n?.place, "chargersrc.liverc.com");
});

test("an event-detection label keeps the bracketed race name", () => {
  const n = nameImportedSessions(
    [
      {
        id: "det",
        createdAt: "2026-09-20T12:00:00.000Z",
        sessionCompletedAt: "2026-09-20T14:00:00.000Z",
        sourceUrl: "https://tftr.liverc.com/results/?p=view_race_result&id=9",
        parserId: "liverc_race_result_v1",
        eventDetectionSource: "race",
        eventDetectionSessionLabel: "Race 15: ISTC Modified (ISTC Modified A3-Main)",
        parsedPayload: { sessionDrivers: [{ driverName: "Sam Other", laps: [14] }, { driverName: "Lee Third", laps: [14] }] },
      },
    ],
    viewer,
    opts
  ).get("det");
  assert.equal(n?.title, "ISTC Modified A3-Main");
});

test("groups keep the order of their first session; each day reads newest first", () => {
  const names = nameImportedSessions(
    [
      practice("old", "Jordan Caruso", "2026-09-20T09:00:00.000Z"),
      practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("c", "Jordan Caruso", "2026-09-22T19:48:00.000Z"),
    ],
    viewer,
    opts
  );
  const groups = groupNamedSessions(["old", "a", "c"], (id) => names.get(id));
  assert.deepEqual(
    groups.map((g) => g.items),
    [["old"], ["c", "a"]]
  );
});

test("a session on one of the viewer's runs is theirs, whatever name the sheet printed", () => {
  const n = nameImportedSessions(
    [practice("a", "J CARUSO RACING", "2026-09-22T18:55:00.000Z", { linkedRunId: "run1" })],
    viewer,
    opts
  ).get("a");
  assert.equal(n?.title, "Jordan Caruso · Run 1");
  assert.equal(n?.isViewer, true);
});

test("MYLAPS practice takes the timing site's own session number from its link", () => {
  const n = nameImportedSessions(
    [
      {
        id: "sh5",
        createdAt: "2026-09-16T00:20:10.000Z",
        sessionCompletedAt: "2025-09-28T15:12:36.531Z",
        sourceUrl: "https://speedhive.mylaps.com/practice/4591/activities/6646551409/sessions/5",
        parserId: "speedhive_practice_v1",
        parsedPayload: {
          sessionDrivers: [{ driverName: "28/09/2025, 05:12 pm", laps: [16.2] }],
          sessionHint: { name: "28/09/2025, 05:12 pm" },
          sessionUtcOffsetMinutes: 120,
        },
      },
    ],
    viewer,
    opts
  ).get("sh5");
  // Nothing says whose (an import from before chips were kept): still never a bare "Run 5".
  assert.equal(n?.title, "Unknown driver · Run 5");
  assert.equal(n?.runNumber, 5);
  assert.equal(n?.timeLabel, "5:12 PM");
  // A year that isn't this one shows, without en-GB's comma after the weekday.
  assert.match(n?.dayLabel ?? "", /^Sun 28 Sept? 2025$/);
});

test("label is the name without its driver, or what the driver typed", () => {
  const names = nameImportedSessions(
    [
      practice("a", "Jordan Caruso", "2026-09-22T18:55:00.000Z"),
      practice("b", "Jordan Caruso", "2026-09-22T19:21:00.000Z", { customName: "Diff oil test" }),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("a")?.label, "Run 1");
  assert.equal(names.get("b")?.label, "Diff oil test");
  // LiveRC prints the track's clock written as UTC; the lap sheet needs it to fix its own times.
  assert.equal(names.get("a")?.trackClockIso, "2026-09-22T18:55:00.000Z");
});

test("MYLAPS practice names the chip: your saved name, else its owner's label, else the number", () => {
  const run = (id: string, hint: Record<string, unknown>): SessionNamingRow => ({
    id,
    createdAt: "2026-09-16T00:20:10.000Z",
    sessionCompletedAt: "2025-09-28T15:12:36.531Z",
    sourceUrl: `https://speedhive.mylaps.com/practice/4591/activities/${id}/sessions/5`,
    parserId: "speedhive_practice_v1",
    parsedPayload: {
      sessionDrivers: [{ driverName: "28/09/2025, 05:12 pm", laps: [16.2] }],
      sessionHint: { name: "28/09/2025, 05:12 pm", ...hint },
      sessionUtcOffsetMinutes: 120,
    },
  });
  const names = nameImportedSessions(
    [
      run("11", { practiceTransponder: "2799719", practiceSiteName: "Caruso" }),
      run("12", { practiceTransponder: "7281046", practiceSiteName: "T HILLIER" }),
      run("13", { practiceTransponder: "5550001" }),
      run("14", { practiceTransponder: "4412087", practiceSiteName: "Whatever" }),
    ],
    viewer,
    opts
  );
  assert.equal(names.get("11")?.title, "Caruso · Run 5");
  assert.equal(names.get("12")?.title, "Tim · Run 5");
  assert.equal(names.get("13")?.title, "Transponder 5550001 · Run 5");
  // One of the viewer's own chips is the viewer, by name.
  assert.equal(names.get("14")?.title, "Jordan Caruso · Run 5");
});
