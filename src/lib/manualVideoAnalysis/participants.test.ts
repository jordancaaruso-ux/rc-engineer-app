import test from "node:test";
import assert from "node:assert/strict";
import {
  findParticipant,
  participants,
  removeParticipant,
  setParticipantAnchor,
  swapDriverRoles,
} from "./sessionModel";
import {
  applyDefaultIsOnVideo,
  fillDefaultLapSelection,
  seatAddedSession,
  sessionTimeClash,
  usedRoles,
} from "./timing";
import {
  MANUAL_VIDEO_SESSION_VERSION,
  nextRivalRole,
  parseManualVideoSession,
  type DriverRole,
  type DriverSlot,
  type ManualDriver,
  type ManualTimingSession,
  type ManualVideoSessionV2,
} from "./types";

function driver(name: string, role: DriverSlot, times: number[]): ManualDriver {
  return {
    key: `${name}-key`,
    driverName: name,
    normalizedName: name.toLowerCase(),
    role,
    laps: times.map((lapTimeSec, i) => ({ lapNumber: i + 1, lapTimeSec, isIncluded: true })),
  };
}

/** A LiveRC practice link: one session, one driver, nobody else in it. */
function practiceSession(
  id: string,
  name: string,
  role: DriverSlot,
  times: number[],
  atIso?: string
): ManualTimingSession {
  return {
    sessionId: id,
    label: `practice/${name}`,
    sourceUrl: `https://liverc.test/${name}`,
    sessionCompletedAtIso: atIso ?? null,
    isOnVideo: true,
    drivers: [driver(name, role, times)],
    sync: {},
  };
}

const LAPS = [17.2, 17.5, 17.0, 17.4, 17.1];

function sessionWith(timingSessions: ManualTimingSession[]): ManualVideoSessionV2 {
  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: "url",
    timingSessions,
    compare: { my: null, competitor: null, alignAt: "sf_finish" },
    selectedLaps: { me: [1], competitor: [] },
    marks: [],
  };
}

test("three practice links are three people on one video", () => {
  const s = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
    practiceSession("ts3", "Chris", "r3", LAPS),
  ]);
  const roster = participants(s);
  assert.equal(roster.length, 3);
  assert.deepEqual(
    roster.map((p) => p.driver.driverName),
    ["Jordan", "Sandy", "Chris"]
  );
  // Each one carries the timing session their own laps came from.
  assert.deepEqual(
    roster.map((p) => p.sessionId),
    ["ts1", "ts2", "ts3"]
  );
});

test("every session holding somebody is on the video", () => {
  const seated = applyDefaultIsOnVideo([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
    practiceSession("ts3", "Chris", "r3", LAPS),
  ]);
  assert.deepEqual(
    seated.map((s) => s.isOnVideo),
    [true, true, true]
  );
});

test("a duplicate seat is not two people sharing one slot", () => {
  // Two sessions both claiming "competitor" — the scan files work under the role alone, so the
  // second must not answer to the same lookup.
  const seated = applyDefaultIsOnVideo([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
    practiceSession("ts3", "Chris", "competitor", LAPS),
  ]);
  assert.deepEqual(
    seated.map((s) => s.isOnVideo),
    [true, true, false]
  );
});

test("seats are handed out competitor first, then numbered", () => {
  assert.equal(nextRivalRole([]), "competitor");
  assert.equal(nextRivalRole(["me"]), "competitor");
  assert.equal(nextRivalRole(["me", "competitor"]), "r3");
  assert.equal(nextRivalRole(["me", "competitor", "r3"]), "r4");
});

test("adding a link seats the driver it is about and nobody else", () => {
  const raceish: ManualTimingSession = {
    ...practiceSession("ts9", "Sandy", "me", LAPS),
    drivers: [
      driver("Sandy", "me", LAPS),
      driver("Bystander", "competitor", LAPS),
      driver("Another", "other", LAPS),
    ],
  };
  const seated = seatAddedSession(raceish, "r3");
  assert.deepEqual(
    seated.drivers.map((d) => d.role),
    ["r3", "other", "other"]
  );
});

test("usedRoles reports every seat already taken", () => {
  const s = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
  ]);
  assert.deepEqual(usedRoles(s.timingSessions), ["me", "competitor"]);
});

test("an added driver's anchor goes on their own session, not the driver's", () => {
  const s = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
  ]);
  const next = setParticipantAnchor(s, "competitor", {
    videoTimeSec: 31.77,
    lapNumber: 1,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  const mine = next.timingSessions.find((t) => t.sessionId === "ts1")!;
  const theirs = next.timingSessions.find((t) => t.sessionId === "ts2")!;
  assert.equal(mine.sync.anchor, undefined, "the driver's own clock is untouched");
  // Alone in their session, so it is that session's anchor as well as their own.
  assert.equal(theirs.sync.anchor?.videoTimeSec, 31.77);
  assert.equal(theirs.sync.anchorByRole?.competitor?.videoTimeSec, 31.77);
});

test("a rival in a race session gets their own anchor, not the session's", () => {
  const race: ManualTimingSession = {
    ...practiceSession("ts1", "Jordan", "me", LAPS),
    drivers: [driver("Jordan", "me", LAPS), driver("Sandy", "competitor", LAPS)],
    sync: {
      anchor: { videoTimeSec: 10, lapNumber: 1, driverRole: "me", anchorKind: "sf_finish" },
    },
  };
  const next = setParticipantAnchor(sessionWith([race]), "competitor", {
    videoTimeSec: 12.5,
    lapNumber: 1,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  const ts = next.timingSessions[0]!;
  assert.equal(ts.sync.anchor?.driverRole, "me", "the shared anchor still speaks for the field");
  assert.equal(ts.sync.anchorByRole?.competitor?.videoTimeSec, 12.5);
});

test("removing a driver takes their marks, laps and session with them", () => {
  const base = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", LAPS),
  ]);
  const s: ManualVideoSessionV2 = {
    ...base,
    selectedLaps: { me: [1, 2], competitor: [3] },
    marks: [
      { sessionId: "ts1", driverRole: "me", lapNumber: 1, lineKey: "s1", videoTimeSec: 5 },
      { sessionId: "ts2", driverRole: "competitor", lapNumber: 3, lineKey: "s1", videoTimeSec: 9 },
    ],
    lastScan: {
      at: "now",
      sessionId: "ts1",
      rows: [
        { driverRole: "me", lapNumber: 1, lineKey: "s1", videoTimeSec: 5, source: "confirmed", suspect: false, candidates: [] },
        { driverRole: "competitor", lapNumber: 3, lineKey: "s1", videoTimeSec: 9, source: "confirmed", suspect: false, candidates: [] },
      ],
    },
  };
  const next = removeParticipant(s, "competitor");
  assert.equal(next.timingSessions.length, 1, "their practice session goes with them");
  assert.equal(next.marks.length, 1);
  assert.equal(next.marks[0]!.driverRole, "me");
  assert.deepEqual(next.selectedLaps.competitor, [], "their lap choices go too");
  assert.equal(next.lastScan!.rows.length, 1, "stale scan rows would be replayed onto the next driver");
  assert.equal(findParticipant(next, "competitor"), undefined);
});

test("'this is me' swaps two seats and everything filed under them", () => {
  // Sandy's link was pasted first, so Sandy is "me" and Jordan the rival — the wrong way round.
  const base = sessionWith([
    practiceSession("ts1", "Sandy", "me", LAPS),
    practiceSession("ts2", "Jordan", "competitor", LAPS),
  ]);
  const s: ManualVideoSessionV2 = {
    ...base,
    timingSessions: base.timingSessions.map((ts) =>
      ts.sessionId === "ts2"
        ? {
            ...ts,
            sync: {
              anchor: { videoTimeSec: 40, lapNumber: 1, driverRole: "competitor", anchorKind: "sf_start" },
              anchorByRole: {
                competitor: { videoTimeSec: 40, lapNumber: 1, driverRole: "competitor", anchorKind: "sf_start" },
              },
              perLapSfStart: { "competitor:2": 57.3 },
            },
          }
        : ts
    ),
    selectedLaps: { me: [1, 2], competitor: [3] },
    marks: [
      { sessionId: "ts1", driverRole: "me", lapNumber: 1, lineKey: "s1", videoTimeSec: 5 },
      { sessionId: "ts2", driverRole: "competitor", lapNumber: 3, lineKey: "s1", videoTimeSec: 9 },
    ],
    lastScan: {
      at: "now",
      sessionId: "ts1",
      rows: [
        { driverRole: "me", lapNumber: 1, lineKey: "s1", videoTimeSec: 5, source: "confirmed", suspect: false, candidates: [] },
        {
          driverRole: "competitor",
          lapNumber: 3,
          lineKey: "s1",
          videoTimeSec: 9,
          source: "confirmed",
          suspect: false,
          claimedBy: { by: "Sandy", key: "me", lapNumber: 1 },
          candidates: [],
        },
      ],
    },
  };
  const next = swapDriverRoles(s, "me", "competitor");
  const roster = participants(next);
  assert.deepEqual(
    roster.map((p) => [p.role, p.driver.driverName]),
    [
      ["me", "Jordan"],
      ["competitor", "Sandy"],
    ]
  );
  // Jordan's anchor is still Jordan's, under the new name.
  const jordan = next.timingSessions.find((t) => t.sessionId === "ts2")!;
  assert.equal(jordan.sync.anchor?.driverRole, "me");
  assert.equal(jordan.sync.anchorByRole?.me?.videoTimeSec, 40);
  assert.equal(jordan.sync.anchorByRole?.competitor, undefined);
  assert.deepEqual(jordan.sync.perLapSfStart, { "me:2": 57.3 });
  // Marks, lap choices and the saved scan follow the people, not the labels.
  assert.deepEqual(next.selectedLaps, { me: [3], competitor: [1, 2] });
  assert.deepEqual(
    next.marks.map((m) => [m.sessionId, m.driverRole]),
    [
      ["ts1", "competitor"],
      ["ts2", "me"],
    ]
  );
  assert.deepEqual(
    next.lastScan!.rows.map((r) => r.driverRole),
    ["competitor", "me"]
  );
  assert.equal(next.lastScan!.rows[1]!.claimedBy?.key, "competitor");
  // Swapping back is the identity.
  assert.deepEqual(swapDriverRoles(next, "competitor", "me"), s);
});

test("a lap choice survives a save", () => {
  // Normalisation runs on every save. It used to reset every driver to their quickest three, so
  // tapping a chip undid itself half a second later.
  const s = sessionWith([practiceSession("ts1", "Jordan", "me", LAPS)]);
  const chosen: ManualVideoSessionV2 = { ...s, selectedLaps: { me: [4], competitor: [] } };
  assert.deepEqual(fillDefaultLapSelection(chosen).selectedLaps.me, [4]);
});

test("a driver with no choice yet gets their quickest three", () => {
  const s = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Sandy", "competitor", [18.0, 17.0, 19.0, 17.5]),
  ]);
  const filled = fillDefaultLapSelection({ ...s, selectedLaps: { me: [1], competitor: [] } });
  assert.deepEqual(filled.selectedLaps.me, [1], "an existing choice is left alone");
  assert.deepEqual(filled.selectedLaps.competitor, [2, 4, 1]);
});

test("extra drivers' lap choices survive a reload", () => {
  const raw = {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: "url",
    timingSessions: [practiceSession("ts1", "Jordan", "me", LAPS)],
    compare: {},
    selectedLaps: { me: [1], competitor: [2], r3: [7, 8] },
    marks: [{ sessionId: "ts3", driverRole: "r3", lapNumber: 7, lineKey: "s1", videoTimeSec: 4 }],
  };
  const parsed = parseManualVideoSession(raw)!;
  assert.ok(parsed);
  assert.deepEqual(parsed.selectedLaps["r3" as DriverRole], [7, 8]);
  assert.equal(parsed.marks[0]!.driverRole, "r3");
});

test("a session from a different part of the day is called out", () => {
  const mine = practiceSession("ts1", "Jordan", "me", LAPS, "2026-09-01T02:00:00.000Z");
  const theirs = practiceSession("ts2", "Sandy", "competitor", LAPS, "2026-09-01T04:00:00.000Z");
  assert.ok(sessionTimeClash([mine, theirs], "ts2"), "two hours apart is not the same footage");

  const together = practiceSession("ts3", "Chris", "r3", LAPS, "2026-09-01T02:01:00.000Z");
  assert.equal(sessionTimeClash([mine, together], "ts3"), null);
});

test("moving a driver's anchor drops the marks a scan found under the old one, keeps hand marks", () => {
  const s = sessionWith([
    practiceSession("ts1", "Jordan", "me", LAPS),
    practiceSession("ts2", "Cooper", "competitor", LAPS),
  ]);
  // Cooper tapped 35s early (IMG_4521), then scanned: twelve marks found around the wrong place.
  const first = setParticipantAnchor(s, "competitor", {
    videoTimeSec: 14.73,
    lapNumber: 1,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  const scanned = {
    ...first,
    marks: [
      { sessionId: "ts2", driverRole: "competitor" as const, lapNumber: 3, lineKey: "s1", videoTimeSec: 47.7, source: "confirmed" as const },
      { sessionId: "ts2", driverRole: "competitor" as const, lapNumber: 3, lineKey: "s2", videoTimeSec: 49.6, source: "rescued" as const },
      // A mark he placed by hand stays: he saw that one.
      { sessionId: "ts2", driverRole: "competitor" as const, lapNumber: 4, lineKey: "s3", videoTimeSec: 68.3 },
      // Somebody else's marks are not his to lose.
      { sessionId: "ts1", driverRole: "me" as const, lapNumber: 2, lineKey: "s1", videoTimeSec: 40.1, source: "confirmed" as const },
    ],
  };
  // The clock places him 35s later.
  const moved = setParticipantAnchor(scanned, "competitor", {
    videoTimeSec: 50.14,
    lapNumber: 1,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  assert.deepEqual(
    moved.marks.map((m) => `${m.driverRole}:${m.lapNumber}:${m.lineKey}`),
    ["competitor:4:s3", "me:2:s1"]
  );
  // A nudge of a few frames is the same placement; nothing is thrown away.
  const nudged = setParticipantAnchor(scanned, "competitor", {
    videoTimeSec: 14.9,
    lapNumber: 1,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  assert.equal(nudged.marks.length, 4);
  // The same placement expressed on a later lap is the same placement too.
  const laterLap = setParticipantAnchor(scanned, "competitor", {
    videoTimeSec: 14.73 + LAPS[0]! + LAPS[1]!,
    lapNumber: 3,
    driverRole: "competitor",
    anchorKind: "sf_start",
  });
  assert.equal(laterLap.marks.length, 4);
});
