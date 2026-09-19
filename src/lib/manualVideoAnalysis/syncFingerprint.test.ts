import test from "node:test";
import assert from "node:assert/strict";
import { fitLapsToCrossings, type FingerprintLap } from "./syncFingerprint";

/** A driver's laps, irregular the way real ones are. */
function laps(times: number[]): FingerprintLap[] {
  return times.map((lapTimeSec, i) => ({ lapNumber: i + 1, lapTimeSec }));
}

/** Where that driver crosses start/finish on the video, given where their first lap starts. */
function crossingsFor(times: number[], startSec: number, jitterSec = 0): number[] {
  const out: number[] = [];
  let at = startSec;
  for (const t of times) {
    out.push(at + (jitterSec ? (Math.sin(out.length * 12.9898) * jitterSec) : 0));
    at += t;
  }
  return out;
}

const SANDY = [17.24, 17.51, 16.98, 17.33, 17.09, 17.62, 17.18, 17.44, 16.91, 17.27, 17.55, 17.02];
const JORDAN = [16.88, 17.02, 16.75, 17.19, 16.94, 17.31, 16.83, 17.07, 16.79, 17.22, 16.97, 17.11];
const CHRIS = [18.02, 17.88, 18.31, 17.95, 18.12, 17.79, 18.24, 17.91, 18.07, 18.35, 17.86, 18.19];

test("finds a driver among a field of other cars' crossings", () => {
  const all = [
    ...crossingsFor(JORDAN, 12.5),
    ...crossingsFor(SANDY, 31.77),
    ...crossingsFor(CHRIS, 5.2),
  ];
  const fit = fitLapsToCrossings(laps(SANDY), all);
  assert.ok(fit, "should have found Sandy");
  assert.ok(
    Math.abs(fit.lapOneStartSec - 31.77) < 0.05,
    `lap 1 start ${fit.lapOneStartSec} should be 31.77`
  );
  assert.ok(fit.matched >= 10, `matched ${fit.matched} of ${fit.of}`);
  assert.ok(fit.marginLaps >= 2, `margin ${fit.marginLaps}`);
});

test("survives the detector being a frame or two out", () => {
  const all = [
    ...crossingsFor(JORDAN, 12.5, 0.06),
    ...crossingsFor(SANDY, 31.77, 0.06),
    ...crossingsFor(CHRIS, 5.2, 0.06),
  ];
  const fit = fitLapsToCrossings(laps(SANDY), all);
  assert.ok(fit, "jitter within tolerance should still lock");
  assert.ok(Math.abs(fit.lapOneStartSec - 31.77) < 0.15);
  assert.ok(fit.medianErrorSec < 0.1, `median error ${fit.medianErrorSec}`);
});

test("the anchor lands on a real crossing of that driver's", () => {
  const sandy = crossingsFor(SANDY, 31.77);
  const fit = fitLapsToCrossings(laps(SANDY), [...crossingsFor(JORDAN, 12.5), ...sandy]);
  assert.ok(fit);
  const nearest = Math.min(...sandy.map((t) => Math.abs(t - fit.anchorVideoTimeSec)));
  assert.ok(nearest < 0.01, `anchor ${fit.anchorVideoTimeSec} is not one of Sandy's crossings`);
});

test("refuses when the driver is not in the footage at all", () => {
  const all = [...crossingsFor(JORDAN, 12.5), ...crossingsFor(CHRIS, 5.2)];
  const fit = fitLapsToCrossings(laps(SANDY), all);
  assert.equal(fit, null, "nobody matching should be no answer, not a guess");
});

test("finds someone who went in halfway through", () => {
  // Sandy comes out at 40s and pulls in after five laps while the camera keeps running. A part
  // session is still an answer — the fraction is reported, not held against him.
  const sandyPart = crossingsFor(SANDY, 40).slice(0, 5);
  const all = [...crossingsFor(JORDAN, 12.5), ...sandyPart];
  const fit = fitLapsToCrossings(laps(SANDY), all);
  assert.ok(fit, "five laps of a fingerprint is an answer");
  assert.ok(Math.abs(fit.lapOneStartSec - 40) < 0.05);
  assert.ok(fit.matched >= 4 && fit.matched <= 6, `matched ${fit.matched}`);
  assert.ok(fit.of > fit.matched, "should say plainly that he was not there the whole time");
});

test("laps run before the camera started are not counted as misses", () => {
  // Sandy's session began well before recording: his first four laps are simply not in the file.
  // Placing him is still possible from the rest, and those four are not held against him.
  const sandy = crossingsFor(SANDY, -60).filter((t) => t >= 0);
  const jordan = crossingsFor(JORDAN, 2).filter((t) => t <= Math.max(...sandy));
  const fit = fitLapsToCrossings(laps(SANDY), [...jordan, ...sandy]);
  assert.ok(fit, "the visible part of a session is enough");
  assert.ok(Math.abs(fit.lapOneStartSec - -60) < 0.1, `lap 1 at ${fit.lapOneStartSec}`);
  assert.ok(fit.of <= 9, `judged on ${fit.of} laps, but only the visible ones could be seen`);
  assert.equal(fit.matched, fit.of, "every visible lap of his was found");
});

test("refuses a driver whose laps are too regular to tell apart", () => {
  // A metronome has no fingerprint: every placement one lap along fits exactly as well.
  const flat = Array.from({ length: 12 }, () => 17);
  const all = crossingsFor(flat, 20);
  const fit = fitLapsToCrossings(laps(flat), all);
  assert.equal(fit, null, "an ambiguous fit must ask, not pick");
});

test("too few crossings is no answer", () => {
  const fit = fitLapsToCrossings(laps(SANDY), [10, 27.24]);
  assert.equal(fit, null);
});
