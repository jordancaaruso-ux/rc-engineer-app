/**
 * A traced lap survives the trip through disk and the session's housekeeping.
 *
 * `parseV2` rebuilds the session field by field, so a field it does not name is silently dropped
 * on the next save — the first cut of this store would have lost every trace on the first PATCH.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { removeParticipant, setParticipantAnchor, swapDriverRoles } from "./sessionModel";
import {
  LAP_TRACE_VERSION,
  MANUAL_VIDEO_SESSION_VERSION,
  parseManualVideoSession,
  traceKey,
  type DriverRole,
  type ManualDriver,
  type ManualLapTrace,
  type ManualTimingSession,
  type ManualVideoSessionV2,
} from "./types";

function driver(name: string, role: DriverRole, times: number[]): ManualDriver {
  return {
    key: `${name}-key`,
    driverName: name,
    normalizedName: name.toLowerCase(),
    role,
    laps: times.map((lapTimeSec, i) => ({ lapNumber: i + 1, lapTimeSec, isIncluded: true })),
  };
}

const LAPS = [17.2, 17.5, 17.0, 17.4, 17.1];

function race(): ManualTimingSession {
  return {
    sessionId: "race",
    label: "A main",
    isOnVideo: true,
    drivers: [driver("Jordan", "me", LAPS), driver("Sandy", "competitor", LAPS)],
    sync: { anchor: { videoTimeSec: 100, lapNumber: 1, driverRole: "me", anchorKind: "sf_finish" } },
  };
}

function trace(role: DriverRole, lapNumber: number): ManualLapTrace {
  return {
    version: LAP_TRACE_VERSION,
    at: "2026-09-06T00:00:00.000Z",
    sessionId: "race",
    driverRole: role,
    lapNumber,
    frame: { w: 1920, h: 1080 },
    startSec: 100 + lapNumber * 17,
    endSec: 117 + lapNumber * 17,
    points: [
      [100.0, 0.1, 0.2, 0.01, 0.01],
      [100.033, 0.11, 0.2, 0.01, 0.01],
      [100.066, 0.12, 0.21, 0.01, 0.01],
    ],
    holes: [{ fromT: 105, toT: 105.6, why: "lost" }],
    segments: [
      { fromKey: "sf", toKey: "s1", fromT: 100, toT: 103, coverage: 0.95, anchorErr: { from: 0.2, to: null } },
    ],
    quality: { coverage: 0.95, anchorsHit: 5, anchorsTotal: 6, ambiguousFrames: 0, ok: true },
    recipe: "trace-v1",
  };
}

function session(traces?: Record<string, ManualLapTrace>): ManualVideoSessionV2 {
  return {
    version: MANUAL_VIDEO_SESSION_VERSION,
    timingSource: "url",
    timingSessions: [race()],
    compare: { my: null, competitor: null, alignAt: "sf_finish" },
    selectedLaps: { me: [1, 2], competitor: [1] },
    marks: [],
    ...(traces ? { traces } : {}),
  };
}

const roundTrip = (s: ManualVideoSessionV2) => parseManualVideoSession(JSON.parse(JSON.stringify(s)));

test("a trace comes back whole from disk", () => {
  const s = session({ [traceKey("me", 3)]: trace("me", 3) });
  const back = roundTrip(s);
  assert.ok(back);
  assert.deepEqual(back.traces, s.traces);
});

test("a session without traces reads back without the field", () => {
  const back = roundTrip(session());
  assert.ok(back);
  assert.equal(back.traces, undefined);
  assert.equal("traces" in JSON.parse(JSON.stringify(back)), false);
});

test("a damaged trace is dropped on its own; the rest stay", () => {
  const good = trace("me", 3);
  const badOrder: ManualLapTrace = {
    ...trace("me", 4),
    points: [
      [100.1, 0.1, 0.2, 0.01, 0.01],
      [100.05, 0.1, 0.2, 0.01, 0.01],
    ],
  };
  const wrongKey = trace("competitor", 2);
  const oldVersion = { ...trace("me", 5), version: 0 } as unknown as ManualLapTrace;
  const s = session({
    [traceKey("me", 3)]: good,
    [traceKey("me", 4)]: badOrder,
    [traceKey("me", 9)]: wrongKey,
    [traceKey("me", 5)]: oldVersion,
  });
  const back = roundTrip(s);
  assert.ok(back);
  assert.deepEqual(Object.keys(back.traces ?? {}), [traceKey("me", 3)]);
});

test("swapping seats re-keys the traces and the role inside them", () => {
  const s = session({ [traceKey("me", 3)]: trace("me", 3), [traceKey("competitor", 2)]: trace("competitor", 2) });
  const swapped = swapDriverRoles(s, "me", "competitor");
  assert.deepEqual(Object.keys(swapped.traces ?? {}).sort(), [traceKey("competitor", 3), traceKey("me", 2)]);
  assert.equal(swapped.traces![traceKey("competitor", 3)]!.driverRole, "competitor");
  assert.equal(swapped.traces![traceKey("me", 2)]!.driverRole, "me");
  // Swap and swap back: the file it started from.
  assert.deepEqual(swapDriverRoles(swapped, "me", "competitor").traces, s.traces);
});

test("removing a driver takes their traces with them", () => {
  const s = session({ [traceKey("me", 3)]: trace("me", 3), [traceKey("competitor", 2)]: trace("competitor", 2) });
  const gone = removeParticipant(s, "competitor");
  assert.deepEqual(Object.keys(gone.traces ?? {}), [traceKey("me", 3)]);
  const alone = removeParticipant(gone, "me");
  assert.equal(alone.traces, undefined);
});

test("moving a driver's anchor drops their traces, and only theirs", () => {
  const s = session({ [traceKey("me", 3)]: trace("me", 3), [traceKey("competitor", 2)]: trace("competitor", 2) });
  const moved = setParticipantAnchor(s, "me", {
    videoTimeSec: 160,
    lapNumber: 1,
    driverRole: "me",
    anchorKind: "sf_finish",
  });
  assert.deepEqual(Object.keys(moved.traces ?? {}), [traceKey("competitor", 2)]);
  // A nudge of a few frames is the same placement; nothing is thrown away for it.
  const nudged = setParticipantAnchor(s, "me", {
    videoTimeSec: 100.05,
    lapNumber: 1,
    driverRole: "me",
    anchorKind: "sf_finish",
  });
  assert.deepEqual(nudged.traces, s.traces);
});
