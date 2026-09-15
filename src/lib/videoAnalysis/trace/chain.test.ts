/**
 * The chain picks the car, not the nearest thing, because it has to reach the next line.
 *
 * Every case is blobs on a known path with the truth beside it — no pixels. The pixel side is
 * tested through the tracker with a rendered scene.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chainThrough, defaultChainParams, withoutStanding, type ObsFrame } from "./chain";

const FPS = 30;
const DT = 1 / FPS;
const CAR = 20;

/** A car on an arc, so constant velocity is only ever roughly right. */
function ours(t: number): { x: number; y: number } {
  const th = t * 0.8;
  return { x: 500 + 300 * Math.cos(th), y: 300 + 180 * Math.sin(th) };
}

function blob(t: number, pos: { x: number; y: number }, jitter = 0, seed = 0) {
  const j = jitter ? ((Math.sin(seed * 12.9898 + t * 78.233) * 43758.5453) % 1) * jitter : 0;
  return { t, x: pos.x + j, y: pos.y - j, w: CAR, h: CAR * 0.6, area: CAR * CAR * 0.5 };
}

function scene(
  seconds: number,
  extra: (t: number, f: number) => Array<{ x: number; y: number }> = () => [],
  omitOurs: (t: number, f: number) => boolean = () => false
): ObsFrame[] {
  const frames: ObsFrame[] = [];
  const n = Math.round(seconds * FPS);
  for (let f = 0; f < n; f++) {
    const t = 10 + f * DT;
    const blobs = [];
    if (!omitOurs(t, f)) blobs.push(blob(t, ours(t), 3, 1));
    for (const e of extra(t, f)) blobs.push(blob(t, e, 3, 2));
    frames.push({ t, blobs });
  }
  return frames;
}

const anchorsFor = (frames: ObsFrame[]) => ({
  start: { t: frames[0]!.t - DT, ...ours(frames[0]!.t - DT) },
  end: { t: frames[frames.length - 1]!.t + DT, ...ours(frames[frames.length - 1]!.t + DT) },
});

test("a clean lap is followed frame for frame, no holes", () => {
  const frames = scene(3);
  const { start, end } = anchorsFor(frames);
  const r = chainThrough(frames, start, end, defaultChainParams(CAR));
  assert.equal(r.points.length, frames.length);
  assert.deepEqual(r.holes, []);
  assert.equal(r.ambiguousFrames, 0);
  for (const p of r.points) {
    const truth = ours(p.t);
    assert.ok(Math.hypot(p.x - truth.x, p.y - truth.y) < 5, `point at ${p.t} is on the car`);
  }
});

test("a car hidden for a moment leaves one hole, and both ends still meet the lines", () => {
  const frames = scene(3, () => [], (t) => t > 11 && t < 11.7);
  const { start, end } = anchorsFor(frames);
  const r = chainThrough(frames, start, end, defaultChainParams(CAR));
  assert.equal(r.holes.length, 1, `one hole, got ${JSON.stringify(r.holes)}`);
  assert.equal(r.holes[0]!.why, "lost");
  assert.ok(r.holes[0]!.fromT <= 11.0 + DT && r.holes[0]!.toT >= 11.7 - DT, "the hole is the hidden stretch");
  assert.equal(r.points.length, frames.filter((f) => f.blobs.length).length, "every visible frame kept");
});

test("a second car crossing our path does not take the chain with it", () => {
  // The rival comes through the point our car is at 11.5s, at right angles, at the same moment.
  const meet = ours(11.5);
  const rival = (t: number) => ({ x: meet.x + (t - 11.5) * 160, y: meet.y - (t - 11.5) * 90 });
  const frames = scene(3, (t) => (Math.abs(t - 11.5) < 0.6 ? [rival(t)] : []));
  const { start, end } = anchorsFor(frames);
  const r = chainThrough(frames, start, end, defaultChainParams(CAR));
  assert.equal(r.holes.length, 0, `no holes, got ${JSON.stringify(r.holes)}`);
  let wrong = 0;
  for (const p of r.points) {
    const truth = ours(p.t);
    if (Math.hypot(p.x - truth.x, p.y - truth.y) > 6) wrong++;
  }
  assert.equal(wrong, 0, `${wrong} points on the rival`);
});

/**
 * A rival that rides on our car until 11.2s, then drifts smoothly out to five car lengths off
 * the line over the next 1.2s — the way a car takes a wider line, not a right-angle turn.
 */
function peelingRival(t: number): { x: number; y: number } {
  const o = ours(t);
  if (t < 11.2) return o;
  const u = Math.min(1, (t - 11.2) / 1.2);
  const k = u * u * (3 - 2 * u) * 5 * CAR;
  const th = t * 0.8;
  return { x: o.x + Math.cos(th) * k, y: o.y + Math.sin(th) * k };
}

test("with no line to reach, two cars that part ways are an ambiguity, not a guess", () => {
  // With no end anchor, either continuation is a car — so neither is drawn.
  const rival = peelingRival;
  const frames = scene(3.0, (t) => (t >= 10.9 ? [rival(t)] : []));
  const { start } = anchorsFor(frames);
  const r = chainThrough(frames, start, null, defaultChainParams(CAR));
  assert.ok(r.ambiguousFrames >= 5, `the stretch after the split is ambiguous, got ${r.ambiguousFrames}`);
  assert.ok(r.holes.some((h) => h.why === "ambiguous"), `an ambiguous hole, got ${JSON.stringify(r.holes)}`);
  // Before the split, where the two are one, the chain is on the car.
  for (const p of r.points) {
    if (p.t >= 11.2) continue;
    const truth = ours(p.t);
    assert.ok(Math.hypot(p.x - truth.x, p.y - truth.y) < 6);
  }
});

test("with the line to reach, the same two cars are told apart", () => {
  const rival = peelingRival;
  const frames = scene(3.0, (t) => (t >= 10.9 ? [rival(t)] : []));
  const { start, end } = anchorsFor(frames);
  const r = chainThrough(frames, start, end, defaultChainParams(CAR));
  assert.equal(r.holes.length, 0, `no holes, got ${JSON.stringify(r.holes)}`);
  for (const p of r.points) {
    const truth = ours(p.t);
    assert.ok(Math.hypot(p.x - truth.x, p.y - truth.y) < 6, `on the car at ${p.t}`);
  }
});

test("an anchor without a position only asks the chain to cover the frames", () => {
  const frames = scene(2);
  const r = chainThrough(frames, { t: frames[0]!.t - DT, x: null, y: null }, null, defaultChainParams(CAR));
  assert.equal(r.points.length, frames.length);
  assert.deepEqual(r.holes, []);
});

test("nothing seen at all is one hole from line to line", () => {
  const frames = scene(1, () => [], () => true);
  const { start, end } = anchorsFor(frames);
  const r = chainThrough(frames, start, end, defaultChainParams(CAR));
  assert.equal(r.points.length, 0);
  assert.equal(r.holes.length, 1);
  assert.equal(r.holes[0]!.fromT, start.t);
  assert.equal(r.holes[0]!.toT, end.t);
});

test("a thing that stands still for the stretch is not a candidate", () => {
  // A car crossing the window, and a marshal in the same place in every frame.
  const frames = [];
  for (let f = 0; f < 40; f++) {
    frames.push({
      t: 10 + f / 30,
      blobs: [
        { t: 10 + f / 30, x: 100 + f * 8, y: 200, w: 20, h: 10, area: 200 },
        { t: 10 + f / 30, x: 400, y: 300, w: 20, h: 10, area: 220 },
      ],
    });
  }
  const p = { ...defaultChainParams(20), staticShare: 0.5, staticRadius: 0.6 };
  const kept = withoutStanding(frames, p);
  const all = kept.flatMap((x) => x.blobs);
  assert.ok(
    all.every((b) => !(Math.abs(b.x - 400) < 1 && Math.abs(b.y - 300) < 1)),
    "the standing thing is gone"
  );
  assert.equal(all.length, 40, "the car is untouched");
});

test("standing is measured against the stretch, so a slow car survives it", () => {
  // Half a car length a frame is slow, and still nowhere near standing still.
  const frames = [];
  for (let f = 0; f < 40; f++) {
    frames.push({ t: 10 + f / 30, blobs: [{ t: 10 + f / 30, x: 100 + f * 10, y: 200, w: 20, h: 10, area: 200 }] });
  }
  const kept = withoutStanding(frames, { ...defaultChainParams(20), staticShare: 0.5, staticRadius: 0.6 });
  assert.equal(kept.flatMap((x) => x.blobs).length, 40);
});
