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
  assert.equal(recap.rating, null);
  assert.deepEqual(recap.tyres, []);
});
