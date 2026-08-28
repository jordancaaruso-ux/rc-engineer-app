import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupRunRows,
  buildGroupTrendModel,
  type WorkbenchGroupSource,
} from "@/lib/runs/sessionWorkbenchModel";

/**
 * The Sessions run rows show best / top 5 / top 10 side by side, and the two
 * averages are the reason these tests exist: `getAverageTopN` slices to
 * `min(n, laps)`, so on a short run it returns the average of everything it has.
 * Printed under a "Top 10" heading that is a different statistic wearing the
 * same label — a 7-lap run's plain average reading as race pace over ten laps.
 * `buildGroupRunRows` is the only thing standing between that and the screen.
 */

function run(id: string, lapTimes: number[]) {
  return { id, carId: "car_1", car: { name: "A800RR" }, createdAt: new Date(), lapTimes };
}

/** n laps, all distinct so best/top5/top10 can't coincide by accident. */
function laps(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 16.0 + i * 0.1);
}

function group(runs: WorkbenchGroupSource["runs"]): WorkbenchGroupSource {
  return { title: "Test day", type: "Testing", runs };
}

test("a run with 10+ laps carries both averages", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(18))]));
  assert.equal(row!.lapCount, 18);
  assert.equal(row!.best, 16.0);
  // Fastest five are 16.0 … 16.4; fastest ten are 16.0 … 16.9.
  assert.ok(Math.abs(row!.avgTop5! - 16.2) < 1e-9);
  assert.ok(Math.abs(row!.avgTop10! - 16.45) < 1e-9);
});

test("under 10 laps, top 10 is null rather than the run's plain average", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(7))]));
  assert.equal(row!.lapCount, 7);
  assert.equal(row!.avgTop10, null, "7 laps cannot produce a top 10");
  // Top 5 is still honest at 7 laps, so it stays.
  assert.ok(Math.abs(row!.avgTop5! - 16.2) < 1e-9);
});

test("under 5 laps, both averages are null", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(3))]));
  assert.equal(row!.avgTop5, null);
  assert.equal(row!.avgTop10, null);
  // Best is one lap, so it survives where an average of five cannot.
  assert.equal(row!.best, 16.0);
});

test("exactly 5 and exactly 10 laps are inside the boundary, not outside it", () => {
  const [five] = buildGroupRunRows(group([run("r1", laps(5))]));
  assert.notEqual(five!.avgTop5, null);
  assert.equal(five!.avgTop10, null);

  const [ten] = buildGroupRunRows(group([run("r2", laps(10))]));
  assert.notEqual(ten!.avgTop5, null);
  assert.notEqual(ten!.avgTop10, null);
});

test("a run with no laps carries no figures at all", () => {
  const [row] = buildGroupRunRows(group([run("r1", [])]));
  assert.equal(row!.best, null);
  assert.equal(row!.avgTop5, null);
  assert.equal(row!.avgTop10, null);
  assert.equal(row!.lapCount, 0);
});

test("only the fastest run in the group is marked, and green rides on best", () => {
  const rows = buildGroupRunRows(
    group([run("slow", [16.5, 16.6, 16.7]), run("fast", [15.9, 16.1, 16.2])])
  );
  const marked = rows.filter((r) => r.isGroupBest);
  assert.equal(marked.length, 1);
  assert.equal(marked[0]!.id, "fast");
});

/**
 * The row's second line leads with the time of day, and the clock it prints is the
 * one that was at the track — not the reader's. A driver who flies interstate for a
 * meeting and reviews it back home would otherwise see every run shifted by hours,
 * on the one screen whose whole subject is how a day unfolded.
 */
test("time of day prints on the run's own clock, then the owner's, then the reader's", () => {
  const at = new Date("2026-08-24T04:15:00.000Z"); // 2:15 PM in Sydney, 6:15 AM in Berlin

  const [ownZone] = buildGroupRunRows(
    group([{ ...run("r1", laps(6)), userId: "u1", localTimeZone: "Australia/Sydney", createdAt: at }]),
    { viewerTimeZone: "Europe/Berlin" }
  );
  assert.equal(ownZone!.timeLabel, "2:15 PM", "the run's captured zone wins over the reader's");

  // Logged before Run.localTimeZone existed — the owner's account zone stands in.
  const [ownerZone] = buildGroupRunRows(
    group([{ ...run("r2", laps(6)), userId: "u1", localTimeZone: null, createdAt: at }]),
    { ownerTimeZoneByUserId: { u1: "Australia/Sydney" }, viewerTimeZone: "Europe/Berlin" }
  );
  assert.equal(ownerZone!.timeLabel, "2:15 PM");

  // Nothing else known: the reader's zone is the last resort, not the first choice.
  const [viewerZone] = buildGroupRunRows(
    group([{ ...run("r3", laps(6)), userId: "u1", localTimeZone: null, createdAt: at }]),
    { viewerTimeZone: "Europe/Berlin" }
  );
  assert.equal(viewerZone!.timeLabel, "6:15 AM");
});

/**
 * The row's expansion prints "Setup vs Run N" from `setupDiff`, and the three
 * modes are three different things to tell a driver. The one that matters is
 * `no_setup`: a run can be completed with an empty sheet ("log it anyway"), and
 * diffing empty against a real setup reads every field of the previous run as
 * having just been changed — the opposite of what happened.
 */
test("setupDiff separates no-setup, no-baseline and a real diff", () => {
  const newest = { ...run("r3", laps(6)), createdAt: new Date("2026-08-24T05:00:00Z") };
  const middle = { ...run("r2", laps(6)), createdAt: new Date("2026-08-24T04:00:00Z") };
  const oldest = { ...run("r1", laps(6)), createdAt: new Date("2026-08-24T03:00:00Z") };
  const rows = buildGroupRunRows(group([newest, middle, oldest]), undefined, {
    setupDataByRunId: new Map<string, unknown>([
      ["r3", {}],
      ["r2", { camber_front: "-1.5", ride_height_rear: "5.5" }],
      ["r1", { camber_front: "-1.0", ride_height_rear: "5.5" }],
    ]),
  });

  assert.equal(rows[0]!.setupDiff?.mode, "no_setup", "an empty sheet is not 'everything changed'");

  const middleDiff = rows[1]!.setupDiff;
  assert.equal(middleDiff?.mode, "diff");
  assert.equal(middleDiff!.mode === "diff" && middleDiff.rows.length, 1);
  assert.equal(middleDiff!.mode === "diff" && middleDiff.rows[0]!.value, "-1.5");
  assert.equal(middleDiff!.mode === "diff" && middleDiff.rows[0]!.previousValue, "-1");
  assert.equal(middleDiff!.mode === "diff" && middleDiff.previousLabel, "Run 1");

  assert.equal(rows[2]!.setupDiff?.mode, "no_baseline", "the first run on a car has nothing to diff");
});

/** Without snapshots the field is null — the expansion then says so rather than "no changes". */
test("setupDiff is null when the caller passed no setup data", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(6))]));
  assert.equal(row!.setupDiff, null);
});

/**
 * The trend card's readout strip prints the driver's 1–10 verdict beside the lap
 * times, and colours the numeral from `CAR_RATING_BANDS`. `Run.carRating` is a plain
 * nullable Int with no check constraint behind it, so a value outside the picker's
 * scale would land outside every band and fall through to the muted "unrated" ink —
 * printed next to a number that plainly is not unrated. These pin the guard.
 */
test("the trend readout carries the rating and the air it ran in", () => {
  const model = buildGroupTrendModel(
    group([
      {
        ...run("r1", laps(12)),
        carRating: 7,
        conditionsAirTempC: 23.4,
      },
    ])
  );
  assert.equal(model!.runs[0]!.carRating, 7);
  // The Celsius float is passed through whole — rounding happens where it is drawn.
  assert.ok(Math.abs(model!.runs[0]!.airTempC! - 23.4) < 1e-9);
});

test("a rating outside 1–10 is dropped rather than printed in an unrated colour", () => {
  const cases: Array<[number | null | undefined, number | null]> = [
    [0, null],
    [11, null],
    [-3, null],
    [Number.NaN, null],
    [null, null],
    [undefined, null],
    [1, 1],
    [10, 10],
    // The column is an Int, but nothing stops a float arriving; the bands are whole numbers.
    [7.4, 7],
  ];
  for (const [input, expected] of cases) {
    const model = buildGroupTrendModel(group([{ ...run("r1", laps(12)), carRating: input }]));
    assert.equal(model!.runs[0]!.carRating, expected, `carRating ${String(input)}`);
  }
});

test("a run with no conditions logged reports no air temperature", () => {
  const model = buildGroupTrendModel(group([run("r1", laps(12))]));
  assert.equal(model!.runs[0]!.airTempC, null);
  assert.equal(model!.runs[0]!.carRating, null);
});
