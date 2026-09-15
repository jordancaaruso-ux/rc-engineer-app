/**
 * Joining sightings into paths, and — the part that matters — refusing to.
 *
 * The linker has no idea who anything is, so every test here is about what it must NOT do:
 * carry one car's identity onto another when they touch, follow a 40 px car onto a 6 px flicker,
 * or hand a marshal standing at a corner to the naming step as if it were a car.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { Obs, ObsFrame } from "../trace/chain";
import { defaultLinkParams, linkTracklets, spreadOf } from "./link";

const FPS = 30;
const CAR = 40;

function obs(x: number, y: number, t: number, size = CAR): Obs {
  return { t, x, y, w: size, h: size, area: size * size };
}

/** Frames from a list of things, each given as a function of frame index (null = not visible). */
function scene(frames: number, things: Array<(i: number) => Obs | null>): ObsFrame[] {
  const out: ObsFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    const blobs: Obs[] = [];
    for (const thing of things) {
      const o = thing(i);
      if (o) blobs.push({ ...o, t });
    }
    out.push({ t, blobs });
  }
  return out;
}

/** The tracklet holding the most sightings — the one a test usually means by "the car". */
function longest(ts: ReturnType<typeof linkTracklets>["tracklets"]) {
  return [...ts].sort((a, b) => b.points.length - a.points.length)[0]!;
}

test("a car crossing the frame is one tracklet", () => {
  const frames = scene(40, [(i) => obs(100 + i * 12, 300, 0)]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.tracklets.length, 1);
  assert.equal(r.tracklets[0]!.points.length, 40);
  assert.equal(r.merges, 0);
  assert.equal(r.tracklets[0]!.startedBy, "new");
});

test("a car behind a board is still one tracklet, and says how many frames it lost", () => {
  // Out of sight for eight frames — a quarter of a second, inside the half-second a tracklet
  // may survive.
  const frames = scene(40, [(i) => (i >= 16 && i < 24 ? null : obs(100 + i * 12, 300, 0))]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.tracklets.length, 1, "the board split the car into two tracklets");
  assert.equal(r.tracklets[0]!.points.length, 32);
  assert.ok(r.tracklets[0]!.gaps >= 8, `expected the lost frames to be counted, got ${r.tracklets[0]!.gaps}`);
});

test("out of sight for longer than the limit ends it, rather than joining across the gap", () => {
  // Twenty frames is two thirds of a second: past `maxGapSec`.
  const frames = scene(60, [(i) => (i >= 20 && i < 40 ? null : obs(100 + i * 12, 300, 0))]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.tracklets.length, 2, "a gap past the limit was bridged anyway");
});

test("two cars that touch have the moment written on both, and both carry on", () => {
  // Two cars converging until they are ONE blob for a few frames, then apart again. That single
  // bigger blob is what the pixel side actually produces when two cars overlap, and it is the
  // whole point: while it lasts there is nothing in the picture that could tell them apart.
  const frames: ObsFrame[] = [];
  for (let i = 0; i < 40; i++) {
    const t = i / FPS;
    const ax = 100 + i * 20;
    const bx = 900 - i * 20;
    frames.push({
      t,
      blobs:
        Math.abs(ax - bx) < CAR
          ? [{ ...obs((ax + bx) / 2, 300, t, Math.round(CAR * 1.6)) }]
          : [obs(ax, 300, t), obs(bx, 300, t)],
    });
  }
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.ok(r.merges >= 1, "two cars occupying one blob was not noticed");
  // The moment is written down on the path rather than ending it. Cutting here on suspicion is
  // what wrecked the real footage: paths that never reach a start line are never named, and it is
  // the naming that could have said whether anything changed hands at all.
  const doubted = r.tracklets.filter((t) => t.doubts.length > 0);
  assert.ok(doubted.length >= 1, "the merge was not recorded on any path");
  for (const t of doubted) {
    for (const d of t.doubts) {
      assert.ok(d > 15 / FPS && d < 26 / FPS, `a doubt was recorded at ${d.toFixed(2)}s, nowhere near the touch`);
    }
  }
  // And a path does survive it, so there is something left for the sheet to judge.
  assert.ok(
    r.tracklets.some((t) => t.points[0]!.t < 19 / FPS && t.points[t.points.length - 1]!.t > 21 / FPS),
    "every path was destroyed by two cars touching for a few frames"
  );
});

test("a flicker beside a car is never mistaken for it, however close", () => {
  // A car, and a speck a fifth its size sitting right on its path.
  const frames = scene(40, [
    (i) => obs(100 + i * 12, 300, 0),
    (i) => obs(100 + i * 12 + 15, 305, 0, 7),
  ]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  const car = longest(r.tracklets);
  for (const p of car.points) {
    assert.ok(p.w >= CAR * 0.4, `the car's tracklet picked up a ${p.w}px blob — the size memory failed`);
  }
});

test("a marshal standing at a corner all race is furniture, and is counted as such", () => {
  const frames = scene(120, [
    (i) => obs(500 + Math.sin(i / 4) * 6, 400 + Math.cos(i / 4) * 6, 0, 30),
    (i) => obs(100 + i * 8, 300, 0),
  ]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.standing, 1, "the standing thing was not recognised as furniture");
  assert.equal(r.tracklets.length, 1, "something other than the car survived");
  assert.ok(r.tracklets[0]!.points.length > 100);
});

test("a car is never called furniture, however slowly it goes round a hairpin", () => {
  // Two seconds at a hairpin: slow, but it still covers several of its own lengths.
  const frames = scene(90, [(i) => obs(500 + i * 3, 400 + Math.sin(i / 15) * 40, 0)]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.standing, 0, "a slow car was thrown away as furniture");
  assert.equal(r.tracklets.length, 1);
});

test("a blob seen once or twice is too little to say anything about", () => {
  const frames = scene(30, [(i) => (i === 10 || i === 11 ? obs(500, 400, 0) : null)]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.tracklets.length, 0);
  assert.equal(r.tooShort, 1);
});

test("how far a thing strayed from the middle of itself", () => {
  assert.equal(spreadOf([]), 0);
  assert.equal(spreadOf([obs(0, 0, 0)]), 0);
  // Two points ten apart: the middle is between them, so each is five away.
  assert.equal(spreadOf([obs(0, 0, 0), obs(10, 0, 0)]), 5);
});

test("tracklets come back oldest first", () => {
  const frames = scene(60, [
    (i) => (i < 20 ? obs(100 + i * 12, 200, 0) : null),
    (i) => (i >= 30 ? obs(100 + i * 12, 700, 0) : null),
  ]);
  const r = linkTracklets(frames, defaultLinkParams(CAR));
  assert.equal(r.tracklets.length, 2);
  assert.ok(r.tracklets[0]!.points[0]!.t < r.tracklets[1]!.points[0]!.t);
});
