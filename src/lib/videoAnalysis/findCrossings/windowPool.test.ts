/**
 * A window with two cars in it offers both.
 *
 * The nearest-blob trace watches one thing at a time, so when a rival goes through a window a
 * second behind you it can sample the rival's crossing and never yours. The tracker still saw
 * you: a car-like track crossed the line with no frame-pair flip of its own. That crossing used
 * to be thrown away whenever any confirmed pair existed — the pool held the rival alone, your
 * slot was handed the rival's time, and the duplicate rule left a hole (Bendigo S2, 2026-09-02).
 */
import { defaultTrackerConfig, type FrameObs } from "./tracks";
import { resultFromWindow } from "./detector";
import type { BandSample, CrossingTarget } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cfg = defaultTrackerConfig(40);
const FPS = 30;
const dt = 1 / FPS;
/** A blob at (x, y); `signed` is its side of a vertical line at x = 500. */
const blob = (x: number, y: number) => ({ x, y, area: 30, signed: x - 500 });

// Car A drives left to right at 30px a frame and crosses between frames 5 and 6. Car B follows
// the same path fifteen frames later and crosses between frames 20 and 21. Frames 12–14 are empty.
const xA = (f: number) => 335 + 30 * f;
const xB = (f: number) => 335 + 30 * (f - 15);
const frames: FrameObs[] = Array.from({ length: 27 }, (_, f) => ({
  t: f * dt,
  blobs: [...(f <= 11 ? [blob(xA(f), 300)] : []), ...(f >= 15 ? [blob(xB(f), 300)] : [])],
}));
const sample = (fr: FrameObs): BandSample[] =>
  fr.blobs.map((b) => ({ t: fr.t, signed: b.signed, x: b.x, y: b.y }));
const tA = 5.5 * dt;
const tB = 20.5 * dt;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

const target: CrossingTarget = {
  id: "me:3:s2",
  lineKey: "s2",
  lapNumber: 3,
  centerSec: tA,
  truthSec: null,
};

/* ---------- both flips sampled: both confirmed, the nearer one picked ---------- */
{
  const r = resultFromWindow(target, frames.flatMap(sample), frames, cfg);
  assert(r.candidates.length === 2, `two cars, two candidates, got ${r.candidates.length}`);
  assert(r.candidates.every((c) => c.source === "confirmed"), "both flips had a track behind them");
  assert(r.detectedSec != null && near(r.detectedSec, tA), "the pick is the one nearest the guess: car A");
  assert(r.candidates.every((c) => c.dir === 1), "both went the same way");
}

/* ---------- the trace only ever sampled car B: car A is still on offer ---------- */
{
  const samples = frames.filter((fr) => fr.t >= 15 * dt - 1e-9).flatMap(sample);
  const r = resultFromWindow(target, samples, frames, cfg);
  assert(r.source === "confirmed" && r.detectedSec != null && near(r.detectedSec, tB), "the pick stays with the confirmed crossing, car B");
  assert(r.eventCount === 1, "the pool the pick came from is the confirmed one alone");
  assert(r.candidates.length === 2, `car A is still offered, got ${r.candidates.length} candidates`);
  const a = r.candidates.find((c) => near(c.t, tA));
  assert(a && a.source === "rescued" && a.dir === 1, `car A comes back as a rescued crossing: ${JSON.stringify(a)}`);
  const b = r.candidates.find((c) => near(c.t, tB));
  assert(b && b.source === "confirmed", "car B is the confirmed one");
  assert(r.candidates[0]!.t < r.candidates[1]!.t, "candidates come in time order");
}

/* ---------- nothing tracked at all: the bare flips are offered as unconfirmed, as before ---------- */
{
  // One blob that blinks across the line for a single frame is not a car.
  const blink: FrameObs[] = [
    { t: 0, blobs: [blob(480, 300)] },
    { t: dt, blobs: [blob(520, 300)] },
  ];
  const r = resultFromWindow(target, blink.flatMap(sample), blink, cfg);
  assert(r.source === "unconfirmed" || r.source === null, `a flicker is never confirmed, got ${r.source}`);
  assert(r.candidates.every((c) => c.source === "unconfirmed"), "and every candidate says so");
}

console.log("windowPool.test.ts: OK");
