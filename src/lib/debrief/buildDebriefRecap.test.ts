import test from "node:test";
import assert from "node:assert/strict";
import { buildDebriefRecap, type DebriefRunSource } from "@/lib/debrief/buildDebriefRecap";

/**
 * The figures beside a debrief are the meeting's best marks and the run that set each one.
 * These pin what would quietly mislead: a mark credited to the wrong run, a top 5 taken off a
 * short run, a weekend's run named without its day, a tyre line that mixes compounds.
 */

/** n laps around `base`, all distinct so best/top5 can't coincide by accident. */
function laps(n: number, base: number): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 0.1);
}

function run(
  id: string,
  at: string,
  lapTimes: number[],
  extra?: Partial<DebriefRunSource>
): DebriefRunSource {
  return {
    id,
    carId: "car_1",
    car: { name: "A800RR" },
    createdAt: new Date(at),
    sortAt: new Date(at),
    localTimeZone: "Australia/Brisbane",
    lapTimes,
    ...extra,
  };
}

/** Newest-first, as the Sessions group holds them. */
function group(runs: DebriefRunSource[]) {
  return { title: "Test day", type: "Testing" as const, runs: [...runs].reverse() };
}

test("each mark names the run that set it, and they need not be the same run", () => {
  const recap = buildDebriefRecap(
    group([
      // r1: one flyer (15.5) then slow laps — best lap, poor top 5.
      run("r1", "2026-08-19T00:00:00Z", [15.5, ...laps(9, 16.4)]),
      // r2: no flyer, but a tight run — best top 5 and, with 20 laps of 16.0, the best stint.
      run("r2", "2026-08-19T01:00:00Z", laps(20, 16.0)),
    ])
  );
  assert.ok(recap);
  assert.equal(recap.dayCount, 1);
  assert.equal(recap.best?.seconds, 15.5);
  assert.equal(recap.best?.runId, "r1");
  assert.equal(recap.top5?.runId, "r2");
  assert.equal(recap.fiveMin?.runId, "r2");
  assert.match(recap.fiveMin!.label, /^\d+\/\d:\d{2}\.\d$/);
  // One day: the run name is enough.
  assert.equal(recap.best?.dayLabel, null);
});

test("a top 5 needs five clean laps — a short run cannot hold the mark", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(3, 15.0)),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 16.0)),
    ])
  );
  assert.ok(recap);
  assert.equal(recap.best?.runId, "r1");
  assert.equal(recap.top5?.runId, "r2");
});

test("on a weekend the marks are meeting-wide and the run carries its day", () => {
  const recap = buildDebriefRecap(
    group([
      run("s1", "2026-09-12T00:00:00Z", laps(8, 16.4), { carRating: 4 }),
      run("s2", "2026-09-12T04:00:00Z", laps(8, 15.6), { carRating: 7 }),
      run("u1", "2026-09-13T00:00:00Z", laps(8, 16.0), { carRating: 7 }),
      run("u2", "2026-09-13T04:00:00Z", laps(8, 16.0), { carRating: 8 }),
    ])
  );
  assert.ok(recap);
  assert.equal(recap.dayCount, 2);
  assert.equal(recap.best?.runId, "s2");
  // "Sep" or "Sept" depending on the ICU data the runtime ships with.
  assert.match(recap.best!.dayLabel!, /^Sat 12 Sept?$/);
  assert.deepEqual(recap.rating?.arc, [4, 7, 7, 8]);
});

test("the rating arc keeps the verdict's rules: two ratings give no direction", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0), { carRating: 5 }),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 15.8), { carRating: 7 }),
    ])
  );
  assert.deepEqual(recap?.rating?.arc, [5, 7]);
  assert.equal(recap?.rating?.direction, null);
});

test("tyres keep their own three marks, in the order first run", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(8, 16.2), {
        tireType: { id: "t1", displayName: "Sweep 36" },
        conditionsAirTempC: 21,
      }),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 15.9), {
        tireType: { id: "t2", displayName: "Sweep 32" },
        conditionsAirTempC: 27,
      }),
      run("r3", "2026-08-19T02:00:00Z", laps(8, 16.0), {
        tireType: { id: "t1", displayName: "Sweep 36" },
        conditionsAirTempC: 25,
      }),
      // No tyre logged: counts for the meeting, never for a tyre line.
      run("r4", "2026-08-19T03:00:00Z", laps(8, 15.7)),
    ])
  );
  assert.ok(recap);
  assert.equal(recap.best?.runId, "r4");
  assert.deepEqual(
    recap.tyres.map((t) => [t.name, t.runCount, t.best]),
    [
      ["Sweep 36", 2, 16.0],
      ["Sweep 32", 1, 15.9],
    ]
  );
  assert.ok(recap.tyres[0]!.top5 != null);
  assert.deepEqual(recap.airTempC, { min: 21, max: 27 });
});

test("a day with no laps still returns a recap with nothing to say", () => {
  const recap = buildDebriefRecap(group([run("r1", "2026-08-19T00:00:00Z", [])]));
  assert.ok(recap);
  assert.equal(recap.runCount, 1);
  assert.equal(recap.lapCount, 0);
  assert.equal(recap.best, null);
  assert.equal(recap.top5, null);
  assert.equal(recap.fiveMin, null);
  assert.equal(recap.field, null);
  assert.equal(recap.rating, null);
  assert.deepEqual(recap.tyres, []);
});

const sweep = { id: "t1", displayName: "Sweep 32" };

test("from new: each later run on a set fitted new here, against its run 1, averaged over the sets", () => {
  // laps(n, base) has a top 5 of base + 0.2, so the deltas below are the bases' differences.
  const recap = buildDebriefRecap(
    group([
      run("a1", "2026-08-19T00:00:00Z", laps(8, 16.0), { tireType: sweep, tireStintId: "A", tireRunNumber: 1 }),
      run("a2", "2026-08-19T01:00:00Z", laps(8, 16.3), { tireType: sweep, tireStintId: "A", tireRunNumber: 2 }),
      run("a3", "2026-08-19T02:00:00Z", laps(8, 16.4), { tireType: sweep, tireStintId: "A", tireRunNumber: 3 }),
      run("b1", "2026-08-19T03:00:00Z", laps(8, 15.9), { tireType: sweep, tireStintId: "B", tireRunNumber: 1 }),
      run("b2", "2026-08-19T04:00:00Z", laps(8, 16.0), { tireType: sweep, tireStintId: "B", tireRunNumber: 2 }),
      // Arrived used: no run 1 at this meeting, so nothing to measure from.
      run("c4", "2026-08-19T05:00:00Z", laps(8, 15.0), { tireType: sweep, tireStintId: "C", tireRunNumber: 4 }),
      run("c5", "2026-08-19T06:00:00Z", laps(8, 17.0), { tireType: sweep, tireStintId: "C", tireRunNumber: 5 }),
    ])
  );
  assert.deepEqual(
    recap?.tyres[0]?.fromNew.map((step) => [step.tyreRun, step.seconds.toFixed(2), step.sets]),
    [
      [2, "0.20", 2], // A +0.3, B +0.1
      [3, "0.40", 1], // A only
    ]
  );
});

test("from new leaves out a set whose age was a guess, and stops at run 5", () => {
  const recap = buildDebriefRecap(
    group([
      run("u1", "2026-08-19T00:00:00Z", laps(8, 16.0), {
        tireType: sweep,
        tireStintId: "U",
        tireRunNumber: 1,
        tireAgeKnown: false,
      }),
      run("u2", "2026-08-19T01:00:00Z", laps(8, 16.5), {
        tireType: sweep,
        tireStintId: "U",
        tireRunNumber: 2,
        tireAgeKnown: false,
      }),
      run("n1", "2026-08-19T02:00:00Z", laps(8, 16.0), { tireType: sweep, tireStintId: "N", tireRunNumber: 1 }),
      run("n6", "2026-08-19T03:00:00Z", laps(8, 16.9), { tireType: sweep, tireStintId: "N", tireRunNumber: 6 }),
    ])
  );
  assert.deepEqual(recap?.tyres[0]?.fromNew, []);
});

test("vs field averages the runs whose sheet named you, and the best names its run and day", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-06-27T00:00:00Z", laps(8, 16.0)),
      run("r2", "2026-06-27T01:00:00Z", laps(8, 15.9)),
      // No sheet named you on this one: it counts for the meeting, never for the field line.
      run("r3", "2026-06-28T00:00:00Z", laps(8, 15.8)),
    ]),
    { fieldGapByRunId: new Map([["r1", -0.1], ["r2", -0.5]]) }
  );
  assert.ok(recap?.field);
  assert.equal(recap.field.avg.toFixed(2), "-0.30");
  assert.equal(recap.field.best, -0.5);
  assert.equal(recap.field.runId, "r2");
  assert.equal(recap.field.runCount, 2);
  assert.equal(recap.field.dayLabel, "Sat 27 Jun");
});

test("no run with a field, no vs field line", () => {
  const recap = buildDebriefRecap(group([run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0))]), {
    fieldGapByRunId: new Map(),
  });
  assert.equal(recap?.field, null);
});

/*
 * The setup line: each car's first run against its last. What would mislead here: a tyre or
 * additive pick counted as a setup change, a car that came home where it started reading the
 * same as one nobody touched, a missing sheet reading as "every box changed".
 */

const sheet = (camber: string, rideHeight: string, extra?: Record<string, string>) => ({
  camber_front: camber,
  ride_height_front: rideHeight,
  ...extra,
});

test("setup is the first run against the last, and counts every change made on the way", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0)),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 16.0)),
      run("r3", "2026-08-19T02:00:00Z", laps(8, 16.0)),
    ]),
    {
      setupDataByRunId: new Map<string, unknown>([
        ["r1", sheet("-1", "5", { tires: "Ride 28", additive: "SXT" })],
        ["r2", sheet("-1.5", "5", { tires: "Ride 32" })],
        ["r3", sheet("-2", "5.5", { tires: "Ride 32", additive: "Jack" })],
      ]),
    }
  );
  assert.ok(recap);
  assert.equal(recap.setup.length, 1);
  const setup = recap.setup[0]!;
  assert.equal(setup.startRunId, "r1");
  assert.equal(setup.endRunId, "r3");
  // One car: no name needed.
  assert.equal(setup.carName, null);
  assert.deepEqual(
    setup.rows.map((row) => [row.key, row.previousValue, row.value]),
    [
      ["camber_front", "-1", "-2"],
      ["ride_height_front", "5", "5.5"],
    ]
  );
  // r1→r2 moved camber; r2→r3 moved camber and ride height. Tyres and additive never count.
  assert.equal(setup.made, 3);
});

test("a car that came home where it started says how many changes it took", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0)),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 16.0)),
      run("r3", "2026-08-19T02:00:00Z", laps(8, 16.0)),
    ]),
    {
      setupDataByRunId: new Map<string, unknown>([
        ["r1", sheet("-1", "5")],
        ["r2", sheet("-2", "5")],
        ["r3", sheet("-1.0", "5.0")],
      ]),
    }
  );
  assert.deepEqual(recap?.setup[0]?.rows, []);
  assert.equal(recap?.setup[0]?.made, 2);
});

test("a car nobody touched is unchanged with nothing made", () => {
  const recap = buildDebriefRecap(
    group([
      run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0)),
      run("r2", "2026-08-19T01:00:00Z", laps(8, 16.0)),
    ]),
    {
      setupDataByRunId: new Map<string, unknown>([
        ["r1", sheet("-1", "5", { tires: "Ride 28" })],
        ["r2", sheet("-1", "5", { tires: "Ride 32" })],
      ]),
    }
  );
  assert.deepEqual(recap?.setup[0]?.rows, []);
  assert.equal(recap?.setup[0]?.made, 0);
});

test("two cars get a line each, named; a car that ran once has nothing to compare", () => {
  const recap = buildDebriefRecap(
    group([
      run("a1", "2026-08-19T00:00:00Z", laps(8, 16.0), { carId: "car_a", car: { name: "A800RR" } }),
      run("b1", "2026-08-19T01:00:00Z", laps(8, 16.0), { carId: "car_b", car: { name: "X4" } }),
      run("a2", "2026-08-19T02:00:00Z", laps(8, 16.0), { carId: "car_a", car: { name: "A800RR" } }),
      run("c1", "2026-08-19T03:00:00Z", laps(8, 16.0), { carId: "car_c", car: { name: "Once" } }),
      run("b2", "2026-08-19T04:00:00Z", laps(8, 16.0), { carId: "car_b", car: { name: "X4" } }),
    ]),
    {
      setupDataByRunId: new Map<string, unknown>([
        ["a1", sheet("-1", "5")],
        ["a2", sheet("-2", "5")],
        ["b1", sheet("-1", "5")],
        ["b2", sheet("-1", "5")],
        ["c1", sheet("-1", "5")],
      ]),
    }
  );
  assert.deepEqual(
    recap?.setup.map((s) => [s.carId, s.carName, s.rows.length, s.made]),
    [
      ["car_a", "A800RR", 1, 1],
      ["car_b", "X4", 0, 0],
    ]
  );
});

test("no sheets loaded, no setup line; a run whose sheet is missing is skipped, not blank", () => {
  const runs = [
    run("r1", "2026-08-19T00:00:00Z", laps(8, 16.0)),
    run("r2", "2026-08-19T01:00:00Z", laps(8, 16.0)),
    run("r3", "2026-08-19T02:00:00Z", laps(8, 16.0)),
  ];
  assert.deepEqual(buildDebriefRecap(group(runs))?.setup, []);
  const recap = buildDebriefRecap(group(runs), {
    setupDataByRunId: new Map<string, unknown>([
      ["r1", sheet("-1", "5")],
      ["r3", sheet("-2", "5")],
    ]),
  });
  assert.equal(recap?.setup[0]?.startRunId, "r1");
  assert.equal(recap?.setup[0]?.endRunId, "r3");
  assert.equal(recap?.setup[0]?.rows.length, 1);
  assert.equal(recap?.setup[0]?.made, 1);
});
