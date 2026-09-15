/**
 * The tracer follows a rendered car, and the chain draws only what it can vouch for.
 *
 * Every case: a scene is rendered, the tracer is seeded at the first crossing and reads its own
 * moving window frame by frame, then the chain is pinned between the two crossings. The truth is
 * the path the car was painted on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chainThrough, defaultChainParams } from "./chain";
import { ellipseLap, renderPathScene, type PathScene } from "./synthetic";
import { LapTracer } from "./tracker";

const W = 640;
const H = 360;
const FPS = 30;
const CAR = 14;
const START = 10;
const LAP = 4;

const lap = ellipseLap(320, 180, 240, 110, LAP, START);

function run(over: Partial<PathScene> = {}, seconds = LAP) {
  const scene = renderPathScene({ frameW: W, frameH: H, fps: FPS, startSec: START, seconds, carPx: CAR, path: lap, ...over });
  const tracer = new LapTracer({ frameW: W, frameH: H, carPx: CAR, thresh: 14, recipeMinArea: 12, channels: 4 });
  const first = lap(START);
  const endT = scene.tAt(scene.frames - 1) + 1 / FPS;
  const end = { t: endT, ...lap(endT) };
  tracer.seed(first.x, first.y, START - 1 / FPS);
  for (let f = 0; f < scene.frames; f++) {
    const t = scene.tAt(f);
    const roi = tracer.windowAt(t, end);
    tracer.push(scene.readWindow(f, roi), roi, t, end);
  }
  const result = chainThrough(tracer.frames, { t: START - 1 / FPS, ...first }, end, defaultChainParams(CAR));
  return { scene, tracer, result };
}

/** How far each chosen point sits from the painted car, in car lengths. */
function errors(r: ReturnType<typeof run>) {
  return r.result.points.map((p) => {
    const truth = r.scene.truth(p.t);
    return Math.hypot(p.x - truth.x, p.y - truth.y) / CAR;
  });
}

test("a clean lap is followed nearly every frame, on the car", () => {
  const r = run();
  const coverage = r.result.points.length / r.tracer.frames.length;
  assert.ok(coverage > 0.95, `coverage ${coverage.toFixed(3)}`);
  assert.deepEqual(r.result.holes, []);
  assert.equal(r.tracer.shakeFrames, 0);
  const worst = Math.max(...errors(r));
  assert.ok(worst < 0.75, `worst error ${worst.toFixed(2)} car lengths`);
});

test("a car hidden for half a second leaves one hole and is picked up again", () => {
  const r = run({ hidden: (t) => t > 11.2 && t < 11.8 });
  const lost = r.result.holes.filter((h) => h.why === "lost");
  assert.equal(lost.length, 1, `one lost hole, got ${JSON.stringify(r.result.holes)}`);
  assert.ok(lost[0]!.fromT <= 11.25 && lost[0]!.toT >= 11.75, "the hole covers the hidden stretch");
  const after = r.result.points.filter((p) => p.t > 11.9).length;
  const framesAfter = r.tracer.frames.filter((f) => f.t > 11.9).length;
  assert.ok(after / framesAfter > 0.9, `followed again after: ${after}/${framesAfter}`);
  const worst = Math.max(...errors(r));
  assert.ok(worst < 0.75, `worst error ${worst.toFixed(2)} car lengths`);
});

test("a rival crossing our path is not followed", () => {
  const meet = lap(12.0);
  const r = run({
    rival: {
      carPx: CAR,
      colour: [40, 90, 220],
      path: (t) => ({ x: meet.x + (t - 12.0) * 150, y: meet.y - (t - 12.0) * 120 }),
    },
  });
  assert.equal(r.result.holes.length, 0, `no holes, got ${JSON.stringify(r.result.holes)}`);
  // While the two cars overlap on the picture they are one blob, and its centre is between them;
  // the test is what happens once they are apart again.
  const rivalAt = (t: number) => ({ x: meet.x + (t - 12.0) * 150, y: meet.y - (t - 12.0) * 120 });
  let worstApart = 0;
  for (const p of r.result.points) {
    const truth = r.scene.truth(p.t);
    const rv = rivalAt(p.t);
    if (Math.hypot(rv.x - truth.x, rv.y - truth.y) < 2 * CAR) continue;
    worstApart = Math.max(worstApart, Math.hypot(p.x - truth.x, p.y - truth.y) / CAR);
  }
  assert.ok(worstApart < 0.75, `worst error ${worstApart.toFixed(2)} car lengths — the chain went with the rival`);
});

test("one shaken frame is skipped, not read as a car", () => {
  const r = run({ shakeAt: (f) => (f === 45 ? 7 : 0) });
  assert.ok(r.tracer.shakeFrames >= 1, "the shaken frame was noticed");
  assert.deepEqual(r.result.holes, []);
  const worst = Math.max(...errors(r));
  assert.ok(worst < 0.75, `worst error ${worst.toFixed(2)} car lengths`);
});
