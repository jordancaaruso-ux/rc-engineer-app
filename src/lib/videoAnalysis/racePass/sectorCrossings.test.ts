/**
 * Reading a named lap's sector crossings off its own path.
 *
 * The scene's crossing times are known exactly — a quarter, a half and three quarters of the way
 * through each lap — so "within one frame" is a real claim here. The tests that matter most are
 * the hairpin, where one line is genuinely crossed twice a lap, and the tie, where the answer has
 * to be "I don't know" rather than a coin toss.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { medianBackground } from "../trace/background";
import type { ObsFrame } from "../trace/chain";
import { CoarseDetector } from "./coarse";
import { defaultLinkParams, linkTracklets } from "./link";
import { nameByTheSheet, type SheetDriver } from "./name";
import { orderable, sectorCrossings } from "./sectorCrossings";
import type { StripCandidate } from "./pathCrossings";
import {
  lapStartsFrom,
  renderScene,
  SCENE_CAR,
  SCENE_FPS,
  SCENE_H,
  SCENE_HAIRPIN,
  SCENE_LINES,
  SCENE_W,
  trueCrossing,
  type Scene,
  type SceneDriver,
} from "./scene";

const FRAME_SEC = 1 / SCENE_FPS;
const SF = SCENE_LINES[0]!;
const CORNERS = SCENE_LINES.slice(1);

function pipeline(scene: Scene, opts: { corners?: typeof CORNERS; candidates?: Map<string, StripCandidate[]> } = {}) {
  const rendered = renderScene(scene);
  const every = Math.max(1, Math.floor(rendered.length / 9));
  const picked = [];
  for (let i = 0; i < rendered.length && picked.length < 9; i += every) picked.push(rendered[i]!.frame);
  const bg = medianBackground(picked);
  assert.ok(bg);
  const det = new CoarseDetector({ w: SCENE_W, h: SCENE_H, divisor: 1, thresh: 10, carPx: SCENE_CAR });
  det.setBackground(bg);
  const frames: ObsFrame[] = [];
  for (const { t, frame } of rendered) {
    const f = det.push(frame, t);
    frames.push({ t: f.t, blobs: f.blobs });
  }
  const linked = linkTracklets(frames, defaultLinkParams(SCENE_CAR));
  const sheet: SheetDriver[] = scene.drivers.map((d) => ({
    key: d.key,
    name: d.name,
    laps: d.lapStarts.slice(0, -1).map((start, i) => ({
      lapNumber: d.firstLapNumber + i,
      startSec: start,
      lapTimeSec: d.lapStarts[i + 1]! - start,
    })),
  }));
  const named = nameByTheSheet({
    tracklets: linked.tracklets,
    sfLine: SF,
    frameW: SCENE_W,
    frameH: SCENE_H,
    sheet,
    sfCandidates: [],
    carPx: SCENE_CAR,
  });
  const sectors = sectorCrossings({
    laps: named.laps,
    lines: opts.corners ?? CORNERS,
    frameW: SCENE_W,
    frameH: SCENE_H,
    candidatesByLine: opts.candidates ?? new Map(),
    carPx: SCENE_CAR,
  });
  return { named, sectors };
}

function soloScene(extras: Scene["extras"] = {}, lateral = 0): Scene {
  const d: SceneDriver = {
    key: "me",
    name: "Jordan",
    firstLapNumber: 1,
    lapStarts: lapStartsFrom(1.0, [4.0, 4.2, 3.9, 4.1, 4.05]),
    lateral,
  };
  return { drivers: [d], extras, fromSec: 0, toSec: d.lapStarts[d.lapStarts.length - 1]! + 0.5 };
}

test("every sector crossing lands within a frame of the truth", () => {
  const scene = soloScene();
  const d = scene.drivers[0]!;
  const { sectors } = pipeline(scene);
  assert.ok(sectors.crossings.length >= 9, `only ${sectors.crossings.length} crossings were read`);
  let worst = 0;
  for (const c of sectors.crossings) {
    const truth = trueCrossing(d, c.lapNumber - d.firstLapNumber, c.lineKey);
    assert.ok(truth != null, `no truth for ${c.lineKey} lap ${c.lapNumber}`);
    const err = Math.abs(c.t - truth!);
    worst = Math.max(worst, err);
    assert.ok(err <= FRAME_SEC, `${c.lineKey} lap ${c.lapNumber} was ${(err * 1000).toFixed(0)}ms out`);
    assert.equal(c.unsure, false);
    assert.equal(c.surprise, false);
  }
  assert.ok(worst < FRAME_SEC, `worst error ${(worst * 1000).toFixed(0)}ms`);
});

test("a line the car crosses twice a lap keeps the one in track order", () => {
  // The hairpin line reaches right across the loop, so the car goes over it on both sides —
  // exactly what a real hairpin's line does, and the failure that produced `settleLineShape`.
  const scene = soloScene();
  const d = scene.drivers[0]!;
  const corners = [SCENE_HAIRPIN, SCENE_LINES[2]!, SCENE_LINES[3]!];
  const { sectors } = pipeline(scene, { corners });
  const hairpin = sectors.crossings.filter((c) => c.lineKey === "s1");
  assert.ok(hairpin.length >= 3, `the hairpin was read on only ${hairpin.length} laps`);
  for (const c of hairpin) {
    const truth = trueCrossing(d, c.lapNumber - d.firstLapNumber, "s1")!;
    assert.ok(
      Math.abs(c.t - truth) <= FRAME_SEC,
      `the hairpin took the wrong pass on lap ${c.lapNumber}: ${c.t.toFixed(3)} against ${truth.toFixed(3)}`
    );
    // The other pass is kept as evidence rather than thrown away.
    assert.ok(c.others.length >= 1, "the return leg was not kept as a candidate");
  }
});

test("the strip's own moment is taken where it saw the same crossing", () => {
  const scene = soloScene();
  const d = scene.drivers[0]!;
  // A candidate a hair off the truth at s1 on every lap: near enough to snap to, and its time is
  // the one that should come back, because it was read at full resolution.
  const candidates: StripCandidate[] = [];
  for (let i = 0; i < d.lapStarts.length - 1; i++) {
    const t = trueCrossing(d, i, "s1");
    if (t != null) candidates.push({ t: t + 0.011, quality: 9 });
  }
  const { sectors } = pipeline(scene, { candidates: new Map([["s1", candidates]]) });
  const s1 = sectors.crossings.filter((c) => c.lineKey === "s1");
  assert.ok(s1.length >= 3);
  assert.ok(
    s1.every((c) => c.source === "confirmed"),
    "a crossing the strip also saw was not marked confirmed"
  );
  for (const c of s1) {
    assert.ok(candidates.some((k) => Math.abs(k.t - c.t) < 1e-9), "the strip's moment was not taken");
  }
});

test("with nothing from the strip, a crossing is the path's own and says so", () => {
  const { sectors } = pipeline(soloScene());
  assert.ok(sectors.crossings.every((c) => c.source === "rescued"));
});

test("a lap with no path leaves its lines missing, with a window for the fallback", () => {
  // Hidden for most of the lap, so nothing can be followed through it.
  const d: SceneDriver = {
    key: "me",
    name: "Jordan",
    firstLapNumber: 1,
    lapStarts: lapStartsFrom(1.0, [4.0, 4.2, 3.9, 4.1]),
    hiddenBetween: [[5.2, 8.9]],
  };
  const scene: Scene = { drivers: [d], extras: {}, fromSec: 0, toSec: 18 };
  const { sectors } = pipeline(scene);
  assert.ok(sectors.missing.length > 0, "a lap the path never covered reported nothing missing");
  for (const m of sectors.missing) {
    assert.ok(m.toSec > m.fromSec, "the fallback was handed a window it cannot search");
  }
});

test("track order keeps the arrangement that reaches the most lines, in order", () => {
  // Three lines; the middle one offers a decoy before the first line's crossing.
  const lines = [
    { lineKey: "a", list: [{ t: 1.0 }] },
    { lineKey: "b", list: [{ t: 0.4 }, { t: 2.0 }] },
    { lineKey: "c", list: [{ t: 3.0 }] },
  ] as unknown as Parameters<typeof orderable>[0];
  const live = orderable(lines);
  assert.deepEqual([...live[1]!], [1], "the decoy before the previous line was not ruled out");
  assert.deepEqual([...live[0]!], [0]);
  assert.deepEqual([...live[2]!], [0]);
});

test("two candidates order cannot separate leave the cell unsure rather than guessing", () => {
  // One line, two crossings a tenth apart, and no other laps to learn a usual offset from.
  const lines = [{ lineKey: "a", list: [{ t: 1.0 }, { t: 1.1 }] }] as unknown as Parameters<typeof orderable>[0];
  const live = orderable(lines);
  assert.equal(live[0]!.size, 2, "order pretended to separate two crossings it cannot");
});
