/**
 * Run: `npx tsx src/lib/dashboardVerdict.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeTodayVerdict,
  consistencyPercent,
  consistencyWord,
  type VerdictRunInput,
} from "@/lib/dashboardVerdict";

function run(partial: Partial<VerdictRunInput> & { runLabel: string }): VerdictRunInput {
  return {
    bestLap: null,
    avgTop5: null,
    carRating: null,
    changedRows: [],
    ...partial,
  };
}

const change = (label: string, previous: string, current: string) => ({
  key: label.toLowerCase().replace(/\s+/g, "_"),
  label,
  unit: "",
  previous,
  current,
});

test("no runs → null", () => {
  assert.equal(computeTodayVerdict([]), null);
});

test("single run: no trend, best run named, no change verdict", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.1, avgTop5: 15.3, carRating: 7 }),
  ]);
  assert.ok(v);
  assert.equal(v.runCount, 1);
  assert.equal(v.trend, null);
  assert.equal(v.bestRun?.runLabel, "Run 1");
  assert.equal(v.lastChange, null);
  assert.equal(v.handling?.rating, 7);
  // One rating is a level, not a direction.
  assert.equal(v.handling?.direction, null);
});

test("day trend prefers avg-top-5 and reads faster/slower/steady", () => {
  const faster = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2, avgTop5: 15.4 }),
    run({ runLabel: "Run 2", bestLap: 15.1, avgTop5: 15.35 }),
    run({ runLabel: "Run 3", bestLap: 15.0, avgTop5: 15.15 }),
  ]);
  assert.equal(faster?.trend?.direction, "faster");
  assert.equal(faster?.trend?.metric, "avg");
  // Latest minus the median of 15.4 and 15.35, not minus the first run.
  assert.ok(Math.abs((faster?.trend?.delta ?? 0) - -0.225) < 1e-9);
  assert.deepEqual(faster?.trend?.spark, [15.4, 15.35, 15.15]);

  const slower = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.0 }),
    run({ runLabel: "Run 2", avgTop5: 15.05 }),
    run({ runLabel: "Run 3", avgTop5: 15.3 }),
  ]);
  assert.equal(slower?.trend?.direction, "slower");

  const steady = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.0 }),
    run({ runLabel: "Run 2", avgTop5: 15.02 }),
    run({ runLabel: "Run 3", avgTop5: 15.03 }),
  ]);
  assert.equal(steady?.trend?.direction, "steady");
});

test("two comparable runs get a sparkline but no verdict", () => {
  // The only comparison available is run 2 against run 1 — the anchor this card
  // stopped making. It draws the two points and says nothing.
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.4 }),
    run({ runLabel: "Run 2", avgTop5: 15.15 }),
  ]);
  assert.deepEqual(v?.trend?.spark, [15.4, 15.15]);
  assert.equal(v?.trend?.direction, null);
  assert.equal(v?.trend?.delta, null);
});

test("one cold first run cannot flatter the whole day", () => {
  // The founder report, on the pace row: a green-track opening run made every later run
  // look like progress. Against the MEDIAN of the earlier runs the day is going nowhere.
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 16.0 }),
    run({ runLabel: "Run 2", avgTop5: 15.3 }),
    run({ runLabel: "Run 3", avgTop5: 15.28 }),
    run({ runLabel: "Run 4", avgTop5: 15.31 }),
  ]);
  assert.equal(v?.trend?.direction, "steady");
  assert.ok(Math.abs((v?.trend?.delta ?? 0) - 0.01) < 1e-9);
  // Last-minus-first would have called this 0.69 s of improvement.
});

test("falls back to best lap when fewer than two runs carry an average", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2 }),
    run({ runLabel: "Run 2", bestLap: 15.15 }),
    run({ runLabel: "Run 3", bestLap: 15.05, avgTop5: 15.2 }),
  ]);
  assert.equal(v?.trend?.metric, "best");
  assert.equal(v?.trend?.direction, "faster");
});

test("runs without the metric are skipped, not treated as zero", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.4 }),
    run({ runLabel: "Run 2" }), // no laps logged
    run({ runLabel: "Run 3", avgTop5: 15.1 }),
  ]);
  assert.deepEqual(v?.trend?.spark, [15.4, 15.1]);
});

test("best run is the day's fastest lap, not the latest", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 14.9, avgTop5: 15.2 }),
    run({ runLabel: "Run 2", bestLap: 15.1, avgTop5: 15.3 }),
  ]);
  assert.equal(v?.bestRun?.runLabel, "Run 1");
  assert.equal(v?.bestRun?.bestLap, 14.9);
});

test("last change: helped when the changed run gained on the run before it", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2, avgTop5: 15.45 }),
    run({
      runLabel: "Run 2",
      bestLap: 15.0,
      avgTop5: 15.3,
      changedRows: [change("Front droop", "5.0", "5.5")],
    }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 2");
  assert.equal(v?.lastChange?.verdict, "helped");
  assert.equal(v?.lastChange?.metric, "avg");
  assert.ok(Math.abs((v?.lastChange?.delta ?? 0) - -0.15) < 1e-9);
});

test("last change: hurt, and the LATEST changed run wins", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.3 }),
    run({ runLabel: "Run 2", avgTop5: 15.1, changedRows: [change("Camber", "-2", "-1.5")] }),
    run({ runLabel: "Run 3", avgTop5: 15.35, changedRows: [change("Rear spring", "C6", "C7")] }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 3");
  assert.equal(v?.lastChange?.rows[0]?.label, "Rear spring");
  assert.equal(v?.lastChange?.verdict, "hurt");
});

test("change on the first run of the day → unclear (nothing to compare inside today)", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.2, changedRows: [change("Toe", "1", "1.5")] }),
    run({ runLabel: "Run 2", avgTop5: 15.1 }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 1");
  assert.equal(v?.lastChange?.verdict, "unclear");
  assert.equal(v?.lastChange?.delta, null);
});

test("handling: the arc is today's ratings in order, dial points at the latest", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", carRating: 5 }),
    run({ runLabel: "Run 2", carRating: 6 }),
    run({ runLabel: "Run 3", carRating: 8 }),
  ]);
  assert.deepEqual(v?.handling?.arc, [5, 6, 8]);
  assert.equal(v?.handling?.rating, 8);
  assert.equal(v?.handling?.runLabel, "Run 3");
  assert.equal(v?.handling?.direction, "improving");
});

const ratedDay = (...ratings: number[]) =>
  computeTodayVerdict(
    ratings.map((carRating, i) => run({ runLabel: `Run ${i + 1}`, carRating })),
  )?.handling?.direction;

test("handling: a day that bounced says so, whatever its ends", () => {
  // The founder report (2026-08-25): started and finished the same, fluctuated in
  // between, and the card called it "same all day".
  assert.equal(ratedDay(7, 4, 7), "swinging");
  assert.equal(ratedDay(6, 3, 8, 6), "swinging");
  // A bounce is a rise AND a fall of two points, in either order — it does NOT have to
  // end where it started. This one finishes five points up and is still all over.
  assert.equal(ratedDay(3, 8, 3, 8), "swinging");
  // One point each way is a rating wobble, not a swing.
  assert.equal(ratedDay(6, 5, 6, 5), "holding");
});

test("handling: only an unmoved day is 'same all day'", () => {
  assert.equal(ratedDay(7, 7, 7), "flat");
  // Moved early, then settled: not flat, not a direction either.
  assert.equal(ratedDay(4, 8, 8, 8), "holding");
  // The median of an even count lands on a half — 2 and 3 give 2.5 — so the whole-point
  // band is what stops a day of 2 → 3 → 2 reading as "going away".
  assert.equal(ratedDay(2, 3, 2), "holding");
});

test("handling: direction is the latest rating against the median of the earlier ones", () => {
  assert.equal(ratedDay(5, 6, 8), "improving");
  assert.equal(ratedDay(8, 6, 5), "fading");
  // Two ratings is run 2 against run 1 — no verdict, same rule as pace.
  assert.equal(ratedDay(7, 7), null);
  assert.equal(ratedDay(4, 8), null);
  // A rough opening run cannot make the rest of the day look like progress: the median
  // of 4, 7 and 7 is 7, so the car is where it has been, not "coming to you".
  assert.equal(ratedDay(4, 7, 7, 7), "holding");
});

test("handling: unrated runs are skipped, and no ratings at all → null", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", carRating: 6 }),
    run({ runLabel: "Run 2" }), // draft, not yet completed
    run({ runLabel: "Run 3", carRating: 9 }),
  ]);
  assert.deepEqual(v?.handling?.arc, [6, 9]);
  assert.equal(v?.handling?.runLabel, "Run 3");

  const none = computeTodayVerdict([run({ runLabel: "Run 1", bestLap: 15.0 })]);
  assert.equal(none?.handling, null);
});

test("handling: survives a run with no laps at all — the old consistency row could not", () => {
  const v = computeTodayVerdict([run({ runLabel: "Run 1", carRating: 4 })]);
  assert.equal(v?.handling?.rating, 4);
  assert.equal(v?.bestRun?.bestLap, null);
});

test("a run's position rides through to every row that names one", () => {
  // A day whose sessions all share one name is named by POSITION instead
  // (`resolveDayRunNames`), and the card turns that into "Best was run 2 of 3"
  // rather than repeating a word that named every run today.
  const verdict = computeTodayVerdict([
    run({ runLabel: "Run 1", runPosition: 1, bestLap: 15.4, avgTop5: 15.6, carRating: 5 }),
    run({
      runLabel: "Run 2",
      runPosition: 2,
      bestLap: 15.0,
      avgTop5: 15.2,
      carRating: 7,
      changedRows: [change("Front sway", "1.4", "1.5")],
    }),
    run({ runLabel: "Run 3", runPosition: 3, bestLap: 15.2, avgTop5: 15.3 }),
  ])!;
  assert.equal(verdict.bestRun?.runPosition, 2);
  assert.equal(verdict.lastChange?.runPosition, 2);
  assert.equal(verdict.handling?.runPosition, 2);
});

test("a day whose sessions name themselves carries no position at all", () => {
  const verdict = computeTodayVerdict([
    run({ runLabel: "Qualifying 1", bestLap: 15.4, carRating: 5 }),
    run({ runLabel: "A Main", bestLap: 15.0, carRating: 7 }),
  ])!;
  // Undefined in, null out — the card then keeps its "Best run was A Main" shape.
  assert.equal(verdict.bestRun?.runPosition, null);
  assert.equal(verdict.handling?.runPosition, null);
});

test("consistency percent: 100 minus the spread's share of the lap (desktop hero only)", () => {
  // The worked example from the hero card: 0.084 s off a 15.04 s lap is 0.56% of the lap.
  assert.equal(consistencyPercent(0.084, 15.04), 99.4);

  // Band edges. 1% spread is the tight cutoff, 2.5% the fair one — so the whole usable
  // range of this number is ~97.5 to 100. That compression is known and accepted; the
  // word is what separates a tight day from a scrappy one at a glance.
  assert.equal(consistencyPercent(0.15, 15.0), 99);
  assert.equal(consistencyPercent(0.375, 15.0), 97.5);
  assert.equal(consistencyWord(0.375, 15.0), "Fair");
  assert.equal(consistencyWord(0.376, 15.0), "Scrappy");

  // A perfect run is 100, and it never goes negative however wild the spread.
  assert.equal(consistencyPercent(0, 15.0), 100);
  assert.equal(consistencyPercent(60, 15.0), 0);

  // No lap to scale by → no percentage. The dial shows an en-dash rather than inventing one.
  assert.equal(consistencyPercent(0.084, null), null);
  assert.equal(consistencyPercent(0.084, 0), null);
});
