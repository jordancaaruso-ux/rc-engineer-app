/**
 * Run: `npx tsx src/lib/lapAnalysis.fade.test.ts`
 *
 * Fade — seconds per MINUTE of track time the run drifted — and the clean-lap cut it stands
 * on. Both exist for sessions nobody here drove: an imported heat carries every marshal
 * call, and this is what keeps one of them from being reported as the driver falling apart.
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
  formatFadePerMinute,
  getCleanLapsInOrder,
  getFadeLapsInOrder,
  getFadePerMinute,
  getFadeProfile,
  getTimedFadeLaps,
  lapRowsFromTimesAndFlags,
  type LapRow,
  type TimedLap,
} from "@/lib/lapAnalysis";

const rows = lapRowsFromTimesAndFlags;
const near = (a: number | null, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;
/** A drift of `perLap` seconds every lap, on laps of about `lapSeconds`, as a per-minute rate. */
const perMinute = (perLap: number, lapSeconds: number) => (perLap * 60) / lapSeconds;
/** The line through the MIDDLE of the laps — the reading the ceiling line replaced (2026-09-14). */
function middleLine(laps: LapRow[]): number {
  const timed: TimedLap[] = getTimedFadeLaps(laps);
  const slopes: number[] = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      slopes.push(
        (timed[j]!.lapTimeSeconds - timed[i]!.lapTimeSeconds) / (timed[j]!.atMinutes - timed[i]!.atMinutes)
      );
  const sorted = slopes.sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

test("fade is the rate the run drifted, in seconds per minute of track time", () => {
  // Out-lap, then a run that gives away exactly five hundredths every ~15-second lap:
  // a fifth of a second every minute.
  const fading = getFadePerMinute(rows([16.0, 15.0, 15.05, 15.1, 15.15, 15.2, 15.25, 15.3]));
  assert.ok(near(fading, perMinute(0.05, 15.15), 0.005), `expected ≈ +0.20 s/min, got ${fading}`);

  // The same run driven backwards: the car came to them.
  const coming = getFadePerMinute(rows([16.0, 15.3, 15.25, 15.2, 15.15, 15.1, 15.05, 15.0]));
  assert.ok(near(coming, -perMinute(0.05, 15.15), 0.005), `expected ≈ −0.20 s/min, got ${coming}`);
});

test("the same drift per lap is a faster fade on a short track — the point of the clock", () => {
  const drift = 0.05;
  const shortTrack = rows([13.0, ...Array.from({ length: 9 }, (_, i) => 12 + i * drift)]);
  const longTrack = rows([31.0, ...Array.from({ length: 9 }, (_, i) => 30 + i * drift)]);
  const short = getFadePerMinute(shortTrack)!;
  const long = getFadePerMinute(longTrack)!;
  assert.ok(near(short, perMinute(drift, 12.2), 0.01), `12 s laps: got ${short}`);
  assert.ok(near(long, perMinute(drift, 30.2), 0.01), `30 s laps: got ${long}`);
  assert.ok(short / long > 2.3 && short / long < 2.7, "the short track goes off ~2.5× faster");
});

test("a metronomic run fades by zero, not by nothing", () => {
  assert.equal(getFadePerMinute(rows(Array.from({ length: 12 }, () => 15.0))), 0);
});

test("the out-lap never counts, whichever way it would have read", () => {
  // A slow standing-start lap in front of a flat run: the thirds figure this replaced
  // would have read the run as coming in. It is flat.
  const slowStart = getFadePerMinute(rows([17.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0]));
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
  assert.equal(getFadePerMinute(six), null);
  assert.equal(fadeOverRunSeconds(six), null);
  assert.equal(getFadePerMinute(rows([15.0, 15.1, 15.0, 15.2, 15.1, 15.0, 15.1])) == null, false);
});

test("a marshal call is cut before the rate is read, but still takes its time on the clock", () => {
  const best = 15.0;
  const survived = best * CLEAN_LAP_MAX_RATIO_TO_BEST + 5;
  const clean = getCleanLapsInOrder(rows([15.0, 15.0, 15.0, survived, 15.0, 15.0, 15.0]));
  assert.equal(clean.length, 6, "the crash lap should not be in the clean set");
  assert.ok(clean.every((l) => l.lapTimeSeconds < survived));
  // …and the run it wrecked still reads as flat.
  assert.equal(getFadePerMinute(rows([15.0, 15.0, 15.0, survived, 15.0, 15.0, 15.0, 15.0])), 0);

  // A steady drift with a crash in the middle: the crash lap is not read, but the clock
  // ran through it, so the drift either side still lines up as ONE rate.
  const drifting = [16.0, 15.0, 15.05, 15.1, 15.15, 40.0, 15.25, 15.3, 15.35, 15.4];
  const withCrash = getFadePerMinute(rows(drifting))!;
  const crashAsLap = getFadeLapsInOrder(rows(drifting)).map((l) => l.lapNumber);
  assert.deepEqual(crashAsLap, [2, 3, 4, 5, 7, 8, 9, 10]);
  // 0.05 s per ~15.2 s lap where laps are back to back; the pairs that straddle the
  // crash see 0.10 s over 15.2 + 40 s — a smaller slope — and the median sits between.
  assert.ok(withCrash > 0.1 && withCrash < perMinute(0.05, 15.2) + 1e-9, `got ${withCrash}`);

  // A bad-but-driven lap stays in: it is part of how the run actually went.
  const scrappy = best * 1.1;
  const withScrappy = getCleanLapsInOrder(rows([15.0, scrappy, 15.0, 15.0, 15.0, 15.0]));
  assert.equal(withScrappy.length, 6);
});

test("a lap missing from the data keeps the clock running", () => {
  const full: LapRow[] = Array.from({ length: 12 }, (_, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: i === 0 ? 16.0 : 15 + (i - 1) * 0.05,
    isIncluded: true,
  }));
  const gapped = full.filter((l) => l.lapNumber !== 6);
  const whole = getFadePerMinute(full)!;
  const gap = getFadePerMinute(gapped)!;
  assert.ok(near(gap, whole, 0.01), `with lap 6 missing the rate should hold: ${whole} vs ${gap}`);
});

test("traffic then one clean lap: the clean lap carries most of the vote, not all of it", () => {
  // Eight clean laps, eight laps stuck behind someone (a second off, well inside the crash
  // cut), then ONE clean lap that matches the start. The middle line reads the traffic as
  // fade; the ceiling line reads the last lap as the car saying it hasn't gone anywhere.
  const clean = [15.02, 14.98, 15.05, 15.01, 14.97, 15.04, 15.0, 15.03];
  const traffic = [16.1, 15.9, 16.3, 16.0, 16.2, 15.95, 16.15, 16.05];
  const oneBack = rows([16.0, ...clean, ...traffic, 15.02]);
  const middle = middleLine(oneBack);
  const ceiling = getFadePerMinute(oneBack)!;
  // Measured: middle +0.28 s/min, ceiling +0.01.
  assert.ok(ceiling < middle / 2, `ceiling ${ceiling} should sit well under the middle ${middle}`);
  assert.ok(Math.abs(ceiling) < 0.05, `the ceiling should read the run as flat, got ${ceiling}`);

  // Two clean laps at the end are stronger evidence than one.
  const twoBack = rows([16.0, ...clean, ...traffic, 15.02, 14.99]);
  assert.ok(getFadePerMinute(twoBack)! <= ceiling + 1e-9);

  // No clean lap at the end: nothing argues, so the fade reads in full — same as the middle,
  // and a real amount (a second over about four minutes).
  const noneBack = rows([16.0, ...clean, ...traffic]);
  const noneCeiling = getFadePerMinute(noneBack)!;
  // Measured: middle +0.35 s/min, ceiling +0.29.
  assert.ok(noneCeiling > 0.15, `nothing argued for the car, so the fade should read, got ${noneCeiling}`);
  assert.ok(noneCeiling > middleLine(noneBack) * 0.7);
});

test("a run that truly faded reads in full: its slow late laps ARE the ceiling", () => {
  const faded = rows([16.0, ...Array.from({ length: 13 }, (_, i) => 15 + i * 0.06)]);
  assert.ok(near(getFadePerMinute(faded), middleLine(faded), 1e-6));

  // Real fade with scrappy laps sprinkled through it: the scrappy laps sit above the
  // ceiling and lose their vote, the drift underneath still reads.
  const drift = Array.from({ length: 13 }, (_, i) => 15 + i * 0.06);
  drift[3]! += 1.2;
  drift[7]! += 0.9;
  drift[10]! += 1.5;
  const fadedScrappy = rows([16.0, ...drift]);
  assert.ok(
    near(getFadePerMinute(fadedScrappy), perMinute(0.06, 15.4), 0.03),
    `got ${getFadePerMinute(fadedScrappy)}`
  );
});

test("scrappy laps that stay in cannot drag the rate — that is the whole point of the median", () => {
  // A flat run with four driven-but-ugly laps, three of them late. The first-third /
  // last-third figure this replaced read a run like this as +0.87s of fade on real data.
  const flatButScrappy = rows([
    17.06, 17.62, 17.45, 17.17, 17.03, 18.6, 17.95, 18.4, 17.53, 18.5, 17.71, 17.57, 17.2,
    18.7, 17.41, 17.09,
  ]);
  const rate = getFadePerMinute(flatButScrappy);
  assert.ok(rate != null && Math.abs(rate) < perMinute(0.02, 17.5), `a flat run must read flat, got ${rate}`);
});

test("a real fade reads as a rate however long the run was", () => {
  const perLap = 0.04;
  const short = rows([16.0, ...Array.from({ length: 11 }, (_, i) => 15 + i * perLap)]);
  const long = rows([16.0, ...Array.from({ length: 29 }, (_, i) => 15 + i * perLap)]);
  assert.ok(near(getFadePerMinute(short), perMinute(perLap, 15.2), 0.01));
  assert.ok(near(getFadePerMinute(long), perMinute(perLap, 15.56), 0.01));
  // The felt number is the rate spread back over the minutes it was read on — which is
  // the same seconds the per-lap drift adds up to.
  assert.ok(near(fadeOverRunSeconds(short), perLap * 10, 0.02));
  assert.ok(near(fadeOverRunSeconds(long), perLap * 28, 0.05));
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
  assert.equal(profile[0]!.ratePerMinute, 0, "the opening stretch is flat");
  assert.ok(
    near(profile[profile.length - 1]!.ratePerMinute, perMinute(0.1, 15.35), 0.01),
    "the closing stretch carries the full rate"
  );
  // …and it builds between the two rather than jumping. (Read on the clock, the closing
  // windows can ease by a few thousandths as the laps themselves get longer — the same
  // tenth per lap is fractionally less per minute — so the check allows that much.)
  const rates = profile.map((p) => p.ratePerMinute);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i]! >= rates[i - 1]! - 0.01);
});

test("the figure reads as a signed rate with its unit, and the hover as a felt total", () => {
  assert.equal(formatFadePerMinute(0.1612), "+0.16 s/min");
  assert.equal(formatFadePerMinute(-0.1612), "−0.16 s/min");
  assert.equal(formatFadePerMinute(0.003), "0.00 s/min");
  assert.equal(formatFadePerMinute(null), "—");
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

  assert.ok(d.fadePerMinuteDelta != null && d.fadePerMinuteDelta > 0, "the fading column is the positive one");
  // Consistency is a spread in seconds here, so scrappier is a BIGGER number — same
  // direction as every other row on the sheet: positive is the column that lost something.
  assert.ok(
    d.consistencyDelta != null && d.consistencyDelta > 0,
    "the wandering column spreads wider than the metronome"
  );
});

test("a driver with no laps blanks both rather than reading as perfect", () => {
  const empty = buildComparisonSeries("empty", "DNS", "imported", []);
  assert.equal(empty.fadePerMinute, null);
  assert.equal(empty.consistencyStdDev, null);
});
