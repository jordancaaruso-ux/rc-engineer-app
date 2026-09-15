/**
 * Filing the pass's answers on the session.
 *
 * The rule these tests exist to hold is the difference between a decision and a piece of evidence.
 * A mark is read by the sector board as fact, so only a crossing the pass is sure of may become
 * one; everything else still has to be written down, because a held-back reading with its
 * candidates beside it is what makes the next fault diagnosable instead of arguable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseManualVideoSession, type DriverRole } from "@/lib/manualVideoAnalysis/types";
import type { Obs } from "../trace/chain";
import type { LinkResult } from "./link";
import type { NamedLap, NameResult } from "./name";
import type { SectorCrossing, SectorResult } from "./sectorCrossings";
import { RACE_RECIPE, thinToFit, toSession } from "./toSession";

const FRAME = { w: 1920, h: 1080 };

function path(fromSec: number, toSec: number, step = 1 / 30): Obs[] {
  const out: Obs[] = [];
  for (let t = fromSec; t <= toSec + 1e-9; t += step) {
    out.push({ t: Math.round(t * 1e6) / 1e6, x: 500 + (t - fromSec) * 40, y: 400, w: 30, h: 24, area: 720 });
  }
  return out;
}

function lap(over: Partial<NamedLap> = {}): NamedLap {
  const startSec = over.startSec ?? 10;
  const endSec = over.endSec ?? 25;
  return {
    key: "me",
    name: "Jordan",
    role: "me" as DriverRole,
    lapNumber: 3,
    startSec,
    endSec,
    startSource: "confirmed",
    endSource: "confirmed",
    points: path(startSec, endSec),
    pathComplete: true,
    trackletId: 1,
    sfMatched: true,
    sfErrorSec: 0.004,
    ...over,
  };
}

function crossing(over: Partial<SectorCrossing> = {}): SectorCrossing {
  return {
    key: "me",
    name: "Jordan",
    role: "me" as DriverRole,
    lapNumber: 3,
    lineKey: "s1",
    t: 14,
    x: 900,
    y: 500,
    dir: 1,
    source: "confirmed",
    quality: 8,
    others: [],
    surprise: false,
    unsure: false,
    ...over,
  };
}

const EMPTY_LINK: LinkResult = { tracklets: [], standing: 2, tooShort: 5, merges: 3 };

function named(over: Partial<NameResult> = {}): NameResult {
  return {
    laps: [lap()],
    ties: [],
    unnamed: 4,
    cuts: 0,
    bridged: 1,
    namedShare: 0.95,
    sheetCheck: { laps: 5, medianMs: 6, worstMs: 41 },
    verdict: "ok",
    ...over,
  };
}

function run(nameResult: NameResult, sectors: SectorResult) {
  return toSession({
    sessionId: "s1",
    frameW: FRAME.w,
    frameH: FRAME.h,
    named: nameResult,
    sectors,
    linked: EMPTY_LINK,
    sfKey: "sf",
    cornerKeys: ["s1", "s2"],
    seatedRoles: new Set<DriverRole>(["me"]),
    span: { fromSec: 5, toSec: 40 },
    frames: 1000,
    readMs: 20000,
    scale: 4,
    shakeFrames: 1,
    at: "2026-09-08T00:00:00.000Z",
  });
}

test("a crossing the pass is sure of becomes a mark", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  assert.equal(out.marks.length, 1);
  assert.equal(out.marks[0]!.lineKey, "s1");
  assert.equal(out.marks[0]!.videoTimeSec, 14);
  assert.equal(out.marks[0]!.source, "confirmed");
});

test("a crossing it could not separate is written down but never marked", () => {
  const out = run(named(), { crossings: [crossing({ unsure: true })], missing: [] });
  assert.equal(out.marks.length, 0, "an unsure reading was written as a decision");
  assert.equal(out.rows.length, 1, "an unsure reading was not kept as evidence either");
  assert.equal(out.rows[0]!.suspect, true);
  assert.equal(out.rows[0]!.videoTimeSec, 14);
});

test("a reading far from usual is kept, marked, and flagged for a second look", () => {
  const out = run(named(), { crossings: [crossing({ surprise: true })], missing: [] });
  assert.equal(out.marks.length, 1, "a surprising reading was thrown away rather than shown");
  assert.equal(out.rows[0]!.suspect, true);
});

test("what beat what is kept beside every reading", () => {
  const others = [
    { t: 14.6, x: 910, y: 505, dir: -1 as const, index: 3, stepSec: 0.033, solid: true, source: "rescued" as const, snappedToSec: null, quality: null },
  ];
  const out = run(named(), { crossings: [crossing({ others })], missing: [] });
  assert.equal(out.rows[0]!.candidates.length, 1);
  assert.equal(out.rows[0]!.candidates[0]!.t, 14.6);
  assert.equal(out.marks[0]!.candidates?.length, 1);
});

test("a line the pass could not answer is a row with no time, for the fallback", () => {
  const out = run(named(), {
    crossings: [],
    missing: [{ key: "me", name: "Jordan", role: "me" as DriverRole, lapNumber: 3, lineKey: "s2", fromSec: 10, toSec: 25, nearestCarLengths: 4.2 }],
  });
  assert.equal(out.marks.length, 0);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]!.videoTimeSec, null);
  assert.equal(out.rows[0]!.source, null);
});

test("a named lap with a path of its own becomes a trace the compare step can draw", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  const trace = out.traces["me:3"];
  assert.ok(trace, "no trace was written for a complete lap");
  assert.equal(trace.recipe, RACE_RECIPE);
  assert.equal(trace.quality.ok, true);
  assert.ok(trace.points.length > 100);
  // Normalised against the frame, like every other stored position.
  for (const [, x, y] of trace.points) {
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `a point left the frame: ${x}, ${y}`);
  }
  assert.ok(trace.segments.length >= 2, "the lap was not split at its crossings");
  assert.equal(trace.segments[0]!.fromKey, "sf");
  assert.equal(trace.segments[trace.segments.length - 1]!.toKey, "sf");
});

test("a lap whose ends came from different paths gets no trace", () => {
  const out = run(named({ laps: [lap({ pathComplete: false, points: [] })] }), {
    crossings: [crossing()],
    missing: [],
  });
  assert.deepEqual(out.traces, {});
});

test("a gap in a path is a break, never a line drawn across it", () => {
  const points = [...path(10, 12), ...path(13.5, 25)];
  const out = run(named({ laps: [lap({ points })] }), { crossings: [crossing()], missing: [] });
  const trace = out.traces["me:3"]!;
  assert.equal(trace.holes.length, 1);
  assert.ok(trace.holes[0]!.fromT >= 12 && trace.holes[0]!.toT <= 13.6);
  assert.equal(trace.holes[0]!.why, "lost");
});

test("every lap's measured start is written where the sector maths looks for it", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  assert.deepEqual(
    out.measuredLapStarts.map((m) => `${m.role}:${m.lapNumber}=${m.videoTimeSec}`),
    ["me:3=10", "me:4=25"]
  );
});

test("a pass that says the footage and the timing disagree writes nothing", () => {
  const out = run(named({ verdict: "doesnt-line-up", namedShare: 0.2 }), {
    crossings: [crossing()],
    missing: [],
  });
  assert.equal(out.marks.length, 0, "a pass that does not line up still wrote marks");
  assert.deepEqual(out.traces, {});
  assert.deepEqual(out.measuredLapStarts, []);
  assert.equal(out.record.verdict, "doesnt-line-up");
  // The evidence is still kept: it is what a person needs to see to find the wrong anchor.
  assert.equal(out.rows.length, 1);
});

test("a driver with no seat gets no marks and no trace, only evidence", () => {
  const rival = lap({ key: "cooper", name: "Cooper", role: undefined, trackletId: 2 });
  const out = run(named({ laps: [rival] }), {
    crossings: [crossing({ key: "cooper", name: "Cooper", role: undefined })],
    missing: [],
  });
  assert.equal(out.marks.length, 0);
  assert.deepEqual(out.traces, {});
  // A driver with no seat has no role to file a row under either, so the row list is empty and
  // their times live only in the record's own summary.
  assert.equal(out.rows.length, 0);
  assert.equal(out.record.drivers[0]!.key, "cooper");
});

test("the record says what was read and what was given up on", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  assert.equal(out.record.recipe, RACE_RECIPE);
  assert.equal(out.record.frames, 1000);
  assert.equal(out.record.unnamed, 4);
  assert.equal(out.record.standing, 2);
  assert.equal(out.record.merges, 3);
  assert.equal(out.record.bridged, 1);
  assert.equal(out.record.shakeFrames, 1);
  assert.equal(out.record.sheetCheck!.medianMs, 6);
  assert.equal(out.record.drivers[0]!.laps[0]!.sfMatched, true);
});

test("paths are thinned rather than allowed to bloat the session", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  const before = out.traces["me:3"]!.points.length;
  const thinned = thinToFit(out.traces, 200);
  const after = thinned["me:3"]!.points.length;
  assert.ok(after < before, `thinning did nothing: ${before} → ${after}`);
  // The ends survive: they are where the crossings pinned the lap.
  assert.equal(thinned["me:3"]!.points[0]![0], out.traces["me:3"]!.points[0]![0]);
});

test("the record reads back off a stored session", () => {
  const out = run(named(), { crossings: [crossing()], missing: [] });
  const stored = {
    version: 2,
    timingSessions: [],
    marks: [],
    selectedLaps: { me: [], competitor: [] },
    compare: {},
    lastRace: out.record,
  };
  const parsed = parseManualVideoSession(JSON.parse(JSON.stringify(stored)));
  assert.ok(parsed, "the session did not read back at all");
  assert.equal(parsed.lastRace?.verdict, "ok");
  assert.equal(parsed.lastRace?.drivers.length, 1);
});

test("a damaged record is dropped on its own, not taken as the whole session", () => {
  const stored = {
    version: 2,
    timingSessions: [],
    marks: [],
    selectedLaps: { me: [], competitor: [] },
    compare: {},
    lastRace: { at: "x", drivers: "not a list" },
  };
  const parsed = parseManualVideoSession(stored);
  assert.ok(parsed, "one bad record took the whole session down");
  assert.equal(parsed.lastRace, undefined);
});
