/**
 * Naming paths by the timing sheet — the step the whole rebuild turns on.
 *
 * Every test here pushes rendered pixels through the real chain (still picture → two-ways
 * difference → blobs → linker → naming), because the faults being guarded against are exactly the
 * ones that only appear when those stages disagree. The scene's every crossing time is known
 * exactly, so "within one frame" means what it says.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { medianBackground } from "../trace/background";
import type { ObsFrame } from "../trace/chain";
import { CoarseDetector } from "./coarse";
import { defaultLinkParams, linkTracklets } from "./link";
import { nameByTheSheet, type NameResult, type SheetDriver } from "./name";
import {
  lapStartsFrom,
  renderScene,
  SCENE_CAR,
  SCENE_FPS,
  SCENE_H,
  SCENE_LINES,
  SCENE_W,
  trueCrossing,
  type Scene,
  type SceneDriver,
} from "./scene";

const FRAME_SEC = 1 / SCENE_FPS;
const SF = SCENE_LINES[0]!;

/** Nine frames spread over the scene, whose per-pixel middle is the empty track. */
function backgroundOf(rendered: ReturnType<typeof renderScene>) {
  const every = Math.max(1, Math.floor(rendered.length / 9));
  const picked = [];
  for (let i = 0; i < rendered.length && picked.length < 9; i += every) picked.push(rendered[i]!.frame);
  const bg = medianBackground(picked);
  assert.ok(bg, "could not build a still picture of the empty track");
  return bg;
}

function observe(scene: Scene): { frames: ObsFrame[]; shake: number } {
  const rendered = renderScene(scene);
  const det = new CoarseDetector({ w: SCENE_W, h: SCENE_H, divisor: 1, thresh: 10, carPx: SCENE_CAR });
  det.setBackground(backgroundOf(rendered));
  const frames: ObsFrame[] = [];
  for (const { t, frame } of rendered) {
    const f = det.push(frame, t);
    frames.push({ t: f.t, blobs: f.blobs });
  }
  return { frames, shake: det.shakeFrames };
}

/** The sheet as the app would build it, optionally with the whole clock wrong. */
function sheetOf(drivers: SceneDriver[], offsetSec = 0): SheetDriver[] {
  return drivers.map((d) => ({
    key: d.key,
    name: d.name,
    laps: d.lapStarts.slice(0, -1).map((start, i) => ({
      lapNumber: d.firstLapNumber + i,
      startSec: start + offsetSec,
      lapTimeSec: d.lapStarts[i + 1]! - start,
    })),
  }));
}

function run(scene: Scene, opts: { offsetSec?: number; sfCandidates?: Array<{ t: number; quality: number }> } = {}): {
  result: NameResult;
  shake: number;
  tracklets: number;
} {
  const { frames, shake } = observe(scene);
  const linked = linkTracklets(frames, defaultLinkParams(SCENE_CAR));
  const result = nameByTheSheet({
    tracklets: linked.tracklets,
    sfLine: SF,
    frameW: SCENE_W,
    frameH: SCENE_H,
    sheet: sheetOf(scene.drivers, opts.offsetSec ?? 0),
    sfCandidates: opts.sfCandidates ?? [],
    carPx: SCENE_CAR,
  });
  return { result, shake, tracklets: linked.tracklets.length };
}

/** Three cars on the same loop, each lapping at its own irregular pace. */
function field(): SceneDriver[] {
  return [
    { key: "me", name: "Jordan", firstLapNumber: 1, lapStarts: lapStartsFrom(1.0, [4.0, 4.2, 3.9, 4.1, 4.05]), lateral: 0 },
    { key: "cooper", name: "Cooper", firstLapNumber: 1, lapStarts: lapStartsFrom(2.6, [4.6, 4.4, 4.7, 4.5, 4.55]), lateral: 22 },
    { key: "justin", name: "Justin", firstLapNumber: 1, lapStarts: lapStartsFrom(0.4, [5.1, 5.3, 5.0, 5.2, 5.15]), lateral: -22 },
  ];
}

function sceneOf(drivers: SceneDriver[], extras: Scene["extras"] = {}): Scene {
  const last = Math.max(...drivers.map((d) => d.lapStarts[d.lapStarts.length - 1]!));
  return { drivers, extras, fromSec: 0, toSec: last + 0.5 };
}

test("three cars on different lap times are each named on every lap", () => {
  const drivers = field();
  const { result } = run(sceneOf(drivers));
  assert.equal(result.verdict, "ok");
  for (const d of drivers) {
    const mine = result.laps.filter((l) => l.key === d.key);
    // Every lap but the last, which has no crossing after it to close it.
    assert.ok(
      mine.length >= d.lapStarts.length - 2,
      `${d.name} got ${mine.length} laps of a possible ${d.lapStarts.length - 2}`
    );
    for (const lap of mine) {
      const i = lap.lapNumber - d.firstLapNumber;
      const truth = trueCrossing(d, i, "sf")!;
      assert.ok(
        Math.abs(lap.startSec - truth) <= FRAME_SEC,
        `${d.name} lap ${lap.lapNumber} started at ${lap.startSec.toFixed(3)}, truth ${truth.toFixed(3)}`
      );
      assert.equal(lap.sfMatched, true, `${d.name} lap ${lap.lapNumber} disagreed with the sheet`);
    }
  }
  assert.equal(result.ties.length, 0);
  // Three cars sharing one loop pass each other constantly, and every pass cuts both paths by
  // design, so not every lap keeps a path of its own. Most should: a lap with no path is a lap
  // with no racing line and no delta, which is a real loss even though its times are still right.
  const withPath = result.laps.filter((l) => l.pathComplete).length;
  assert.ok(
    withPath >= result.laps.length * 0.5,
    `only ${withPath} of ${result.laps.length} named laps kept a path through the traffic`
  );
  // …and where there is a path, it must actually lie inside its own lap.
  for (const lap of result.laps) {
    if (!lap.pathComplete) continue;
    for (const p of lap.points) {
      assert.ok(p.t >= lap.startSec && p.t <= lap.endSec, `${lap.key} lap ${lap.lapNumber} kept a point from outside it`);
    }
  }
});

test("nobody's car is named nobody: a person standing at a corner all race", () => {
  const drivers = field();
  const scene = sceneOf(drivers, {
    standing: [{ x: 40, y: 120, size: 10, wobble: 2.5, from: 0, to: 40 }],
  });
  const { result } = run(scene);
  assert.equal(result.verdict, "ok");
  // Whether the linker threw them out as furniture or the naming step found them no slot, the
  // person must never end up as somebody's lap.
  for (const lap of result.laps) {
    assert.ok(["me", "cooper", "justin"].includes(lap.key));
  }
  const named = result.laps.length;
  assert.ok(named >= 9, `only ${named} laps survived the presence of one bystander`);
});

test("a car lost in shade at the start line is joined through the strip's own crossing", () => {
  const drivers = [field()[0]!];
  // The start line sits at the top of the loop; this shade covers it.
  const scene = sceneOf(drivers, { shade: { x0: 120, y0: 0, x1: 200, y1: 60 } });
  const bare = run(scene);
  // Without the strip there is nothing to join through, so laps are lost.
  const withStrip = run(scene, {
    sfCandidates: drivers[0]!.lapStarts.map((t) => ({ t, quality: 8 })),
  });
  assert.ok(
    withStrip.result.laps.length >= bare.result.laps.length,
    "handing the strip's crossings over made things worse"
  );
  assert.ok(withStrip.result.bridged > 0 || withStrip.result.laps.length > 0, "the shaded start line lost every lap");
  for (const lap of withStrip.result.laps) {
    const i = lap.lapNumber - drivers[0]!.firstLapNumber;
    const truth = trueCrossing(drivers[0]!, i, "sf")!;
    assert.ok(
      Math.abs(lap.startSec - truth) <= FRAME_SEC,
      `bridged lap ${lap.lapNumber} started at ${lap.startSec.toFixed(3)}, truth ${truth.toFixed(3)}`
    );
  }
});

test("a sync that is a whole lap out writes nothing at all", () => {
  const drivers = field();
  // Every lap start moved by more than a lap: nothing can line up, and the honest answer is to
  // say the sheet and the footage are not describing the same thing.
  const { result } = run(sceneOf(drivers), { offsetSec: 9.4 });
  assert.equal(result.verdict, "doesnt-line-up");
  assert.ok(result.namedShare < 0.5, `named ${(result.namedShare * 100).toFixed(0)}% of the sheet's slots`);
});

test("two cars nose to tail on the same lap time are reported, not guessed between", () => {
  // Identical lap times, identical starts, side by side: nothing in the timing can separate them.
  const twins: SceneDriver[] = [
    { key: "a", name: "Twin A", firstLapNumber: 1, lapStarts: lapStartsFrom(1.0, [4.0, 4.0, 4.0, 4.0]), lateral: 4 },
    { key: "b", name: "Twin B", firstLapNumber: 1, lapStarts: lapStartsFrom(1.0, [4.0, 4.0, 4.0, 4.0]), lateral: -4 },
  ];
  const { result } = run(sceneOf(twins));
  const namedBoth = new Set(result.laps.map((l) => l.key));
  assert.ok(
    result.ties.length > 0 || namedBoth.size < 2,
    "two cars that no timing can tell apart were confidently named anyway"
  );
});

test("two cars on lap times a second apart are told apart without a tie", () => {
  const pair: SceneDriver[] = [
    { key: "a", name: "Ann", firstLapNumber: 1, lapStarts: lapStartsFrom(1.0, [4.0, 4.1, 3.95, 4.05]), lateral: 14 },
    { key: "b", name: "Ben", firstLapNumber: 1, lapStarts: lapStartsFrom(2.1, [5.0, 5.2, 4.9, 5.1]), lateral: -14 },
  ];
  const { result } = run(sceneOf(pair));
  assert.equal(result.ties.length, 0, "two clearly different lap times were called a tie");
  for (const key of ["a", "b"]) {
    assert.ok(
      result.laps.some((l) => l.key === key),
      `${key} was not named at all`
    );
  }
  for (const lap of result.laps) {
    assert.equal(lap.sfMatched, true, `${lap.key} lap ${lap.lapNumber} disagreed with the sheet`);
  }
});

test("a knocked camera costs one frame, not a lap", () => {
  const drivers = [field()[0]!];
  const scene = sceneOf(drivers, { bumpAtSec: 6.0 });
  const { result, shake } = run(scene);
  assert.ok(shake >= 1, "a whole-frame shift was not recognised as the camera");
  assert.equal(result.verdict, "ok");
  assert.ok(result.laps.length >= 3, `a single bumped frame cost ${5 - result.laps.length} laps`);
});

test("the sheet check reports how far the footage and the timing disagree", () => {
  const { result } = run(sceneOf(field()));
  assert.ok(result.sheetCheck, "no sheet check was produced");
  assert.ok(
    result.sheetCheck!.medianMs < 1000 * FRAME_SEC,
    `the median lap disagreed with the sheet by ${result.sheetCheck!.medianMs.toFixed(0)}ms`
  );
});

test("naming the same scene twice gives the same answer", () => {
  const scene = sceneOf(field());
  const a = run(scene).result;
  const b = run(scene).result;
  assert.deepEqual(
    a.laps.map((l) => `${l.key}:${l.lapNumber}:${l.startSec.toFixed(6)}`),
    b.laps.map((l) => `${l.key}:${l.lapNumber}:${l.startSec.toFixed(6)}`)
  );
});
