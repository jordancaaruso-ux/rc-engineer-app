/**
 * Run: `npx tsx src/lib/lapAnalysis.fade.test.ts`
 *
 * Fade — seconds per lap the run drifted — and the clean-lap cut it stands on. Both exist
 * for sessions nobody here drove: an imported heat carries every marshal call, and this is
 * what keeps one of them from being reported as the driver falling apart.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEAN_LAP_MAX_RATIO_TO_BEST,
  FADE_PROFILE_WINDOW,
  MIN_LAPS_FOR_FADE,
  MIN_LAPS_FOR_FADE_PROFILE,
  buildComparisonSeries,
  computeSummaryDeltas,
  fadeOverRunSeconds,
  formatFadeOverRun,
  formatFadePerLap,
  getCleanLapsInOrder,
  getFadeLapsInOrder,
  getFadePerLap,
  getFadeProfile,
  lapRowsFromTimesAndFlags,
} from "@/lib/lapAnalysis";

const rows = lapRowsFromTimesAndFlags;
const near = (a: number | null, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

test("fade is the rate the run drifted, in seconds per lap", () => {
  // Out-lap, then a run that gives away exactly five hundredths every lap.
  const fading = getFadePerLap(rows([16.0, 15.0, 15.05, 15.1, 15.15, 15.2, 15.25, 15.3]));
  assert.ok(near(fading, 0.05), `expected +0.050 s/lap, got ${fading}`);

  // The same run driven backwards: the car came to them.
  const coming = getFadePerLap(rows([16.0, 15.3, 15.25, 15.2, 15.15, 15.1, 15.05, 15.0]));
  assert.ok(near(coming, -0.05), `expected −0.050 s/lap, got ${coming}`);
});

test("a metronomic run fades by zero, not by nothing", () => {
  assert.equal(getFadePerLap(rows(Array.from({ length: 12 }, () => 15.0))), 0);
});

test("the out-lap never counts, whichever way it would have read", () => {
  // A slow standing-start lap in front of a flat run: the thirds figure this replaced
  // would have read the run as coming in. It is flat.
  const slowStart = getFadePerLap(rows([17.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0]));
  assert.equal(slowStart, 0);
  // A lap 1 the crash cut has already removed doesn't cost lap 2 as well.
  const crashedStart = rows([40.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0]);
  assert.deepEqual(
    getFadeLapsInOrder(crashedStart).map((l) => l.lapNumber),
    [2, 3, 4, 5, 6, 7, 8]
  );
});

test("too few laps says nothing rather than something arithmetic", () => {
  // Six laps: the out-lap goes, five remain — one short.
  const six = rows([15.0, 15.1, 15.0, 15.2, 15.1, 15.0]);
  assert.equal(getFadeLapsInOrder(six).length, MIN_LAPS_FOR_FADE - 1);
  assert.equal(getFadePerLap(six), null);
  assert.equal(getFadePerLap(rows([15.0, 15.1, 15.0, 15.2, 15.1, 15.0, 15.1])) == null, false);
});

test("a marshal call is cut before the rate is read", () => {
  const best = 15.0;
  const survived = best * CLEAN_LAP_MAX_RATIO_TO_BEST + 5;
  const clean = getCleanLapsInOrder(rows([15.0, 15.0, 15.0, survived, 15.0, 15.0, 15.0]));
  assert.equal(clean.length, 6, "the crash lap should not be in the clean set");
  assert.ok(clean.every((l) => l.lapTimeSeconds < survived));
  // …and the run it wrecked still reads as flat.
  assert.equal(getFadePerLap(rows([15.0, 15.0, 15.0, survived, 15.0, 15.0, 15.0, 15.0])), 0);

  // A bad-but-driven lap stays in: it is part of how the run actually went.
  const scrappy = best * 1.1;
  const withScrappy = getCleanLapsInOrder(rows([15.0, scrappy, 15.0, 15.0, 15.0, 15.0]));
  assert.equal(withScrappy.length, 6);
});

test("scrappy laps that stay in cannot drag the rate — that is the whole point of the median", () => {
  // A flat run with four driven-but-ugly laps, three of them late. The first-third /
  // last-third figure this replaced read a run like this as +0.87s of fade on real data.
  const flatButScrappy = rows([
    17.06, 17.62, 17.45, 17.17, 17.03, 18.6, 17.95, 18.4, 17.53, 18.5, 17.71, 17.57, 17.2,
    18.7, 17.41, 17.09,
  ]);
  const rate = getFadePerLap(flatButScrappy);
  assert.ok(rate != null && Math.abs(rate) < 0.02, `a flat run must read flat, got ${rate}`);
});

test("a real fade reads as a rate however long the run was", () => {
  const perLap = 0.04;
  const short = rows([16.0, ...Array.from({ length: 11 }, (_, i) => 15 + i * perLap)]);
  const long = rows([16.0, ...Array.from({ length: 29 }, (_, i) => 15 + i * perLap)]);
  assert.ok(near(getFadePerLap(short), perLap));
  assert.ok(near(getFadePerLap(long), perLap));
  // The felt number is the rate spread back over the laps it was read on.
  assert.ok(near(fadeOverRunSeconds(short), perLap * 10));
  assert.ok(near(fadeOverRunSeconds(long), perLap * 28));
});

test("the rolling profile is one rate per six-lap window, and nothing on a short run", () => {
  // Nine clean laps after the out-lap: one short of a profile.
  const short = rows([16.0, ...Array.from({ length: MIN_LAPS_FOR_FADE_PROFILE - 1 }, () => 15)]);
  assert.deepEqual(getFadeProfile(short), []);

  // Flat for six laps, then 0.1 s/lap from lap 8 on.
  const times = [16.0, 15, 15, 15, 15, 15, 15, 15, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6];
  const profile = getFadeProfile(rows(times));
  // 13 fade laps (lap 1 dropped), windows of six: 8 of them.
  assert.equal(profile.length, 13 - FADE_PROFILE_WINDOW + 1);
  assert.deepEqual(
    [profile[0]!.fromLap, profile[0]!.toLap, profile[profile.length - 1]!.toLap],
    [2, 7, 14]
  );
  assert.equal(profile[0]!.ratePerLap, 0, "the opening stretch is flat");
  assert.ok(
    near(profile[profile.length - 1]!.ratePerLap, 0.1),
    "the closing stretch carries the full rate"
  );
  // …and it builds between the two rather than jumping.
  const rates = profile.map((p) => p.ratePerLap);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i]! >= rates[i - 1]! - 1e-9);
});

test("the figure reads as a signed rate with its unit, and the hover as a felt total", () => {
  assert.equal(formatFadePerLap(0.0412), "+0.04 s/lap");
  assert.equal(formatFadePerLap(-0.0412), "−0.04 s/lap");
  assert.equal(formatFadePerLap(0.003), "0.00 s/lap");
  assert.equal(formatFadePerLap(null), "—");
  assert.equal(formatFadeOverRun(0.61), "≈ +0.6 s over the run");
  assert.equal(formatFadeOverRun(-1.24), "≈ −1.2 s over the run");
  assert.equal(formatFadeOverRun(null), undefined);
});

test("the footer's two deltas are signed the way their rows read", () => {
  const target = buildComparisonSeries(
    "target",
    "Me",
    "run",
    rows([15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0])
  );
  // Fades, and wanders while doing it.
  const rival = buildComparisonSeries(
    "rival",
    "Rival",
    "imported",
    rows([15.0, 14.9, 15.1, 15.2, 15.3, 15.2, 15.5, 15.6, 15.4])
  );
  const d = computeSummaryDeltas(target, rival);

  assert.ok(d.fadePerLapDelta != null && d.fadePerLapDelta > 0, "the fading column is the positive one");
  // Consistency is a spread in seconds here, so scrappier is a BIGGER number — same
  // direction as every other row on the sheet: positive is the column that lost something.
  assert.ok(
    d.consistencyDelta != null && d.consistencyDelta > 0,
    "the wandering column spreads wider than the metronome"
  );
});

test("a driver with no laps blanks both rather than reading as perfect", () => {
  const empty = buildComparisonSeries("empty", "DNS", "imported", []);
  assert.equal(empty.fadePerLap, null);
  assert.equal(empty.consistencyStdDev, null);
});
