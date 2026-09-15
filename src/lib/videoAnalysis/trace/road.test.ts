/**
 * The track's shape, learnt only from laps worth learning from.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { roadFrom } from "./road";
import type { ManualLapTrace, TracePoint, TraceSegment } from "@/lib/manualVideoAnalysis/types";

const FRAME = { w: 1000, h: 500 };

/** A lap running straight from x=0.1 to x=0.9 at a fixed y, in one stretch sf→s1. */
function lap(
  y: number,
  over: { coverage?: number; ok?: boolean; hole?: [number, number] } = {}
): ManualLapTrace {
  const points: TracePoint[] = [];
  for (let i = 0; i <= 20; i++) points.push([10 + i / 10, 0.1 + (0.8 * i) / 20, y, 0.02, 0.02]);
  const segments: TraceSegment[] = [
    {
      fromKey: "sf",
      toKey: "s1",
      fromT: 10,
      toT: 12,
      coverage: over.coverage ?? 1,
      anchorErr: { from: 0, to: 0 },
    },
  ];
  return {
    version: 1,
    at: "test",
    sessionId: "s",
    driverRole: "me",
    lapNumber: 1,
    frame: FRAME,
    startSec: 10,
    endSec: 12,
    points,
    holes: over.hole ? [{ fromT: over.hole[0], toT: over.hole[1], why: "lost" }] : [],
    segments,
    quality: { coverage: 1, anchorsHit: 2, anchorsTotal: 2, ambiguousFrames: 0, ok: over.ok ?? true },
    recipe: "trace-v1",
  };
}

test("a clean lap becomes the road, read at shares of the stretch", () => {
  const road = roadFrom([lap(0.5)], FRAME);
  assert.deepEqual(road.stretches, ["sf→s1"]);
  const a = road.at("sf", "s1", 0)!;
  const b = road.at("sf", "s1", 1)!;
  const mid = road.at("sf", "s1", 0.5)!;
  assert.ok(Math.abs(a.x - 100) < 1, `start ${a.x}`);
  assert.ok(Math.abs(b.x - 900) < 1, `end ${b.x}`);
  assert.ok(Math.abs(mid.x - 500) < 20, `middle ${mid.x}`);
  assert.ok(Math.abs(mid.y - 250) < 1, `y ${mid.y}`);
});

test("a stretch nobody has driven is not invented", () => {
  const road = roadFrom([lap(0.5)], FRAME);
  assert.equal(road.at("s3", "s4", 0.5), null);
});

test("a lap the tracer would not vouch for teaches nothing", () => {
  assert.deepEqual(roadFrom([lap(0.5, { ok: false })], FRAME).stretches, []);
});

test("a stretch barely followed, or with a hole across it, teaches nothing", () => {
  assert.deepEqual(roadFrom([lap(0.5, { coverage: 0.4 })], FRAME).stretches, []);
  assert.deepEqual(roadFrom([lap(0.5, { hole: [10.5, 11.5] })], FRAME).stretches, []);
});

test("three laps give the middle of them, so one wrong path cannot move the road", () => {
  const road = roadFrom([lap(0.5), lap(0.52), lap(0.9)], FRAME);
  const mid = road.at("sf", "s1", 0.5)!;
  // 0.5 and 0.52 are the track; 0.9 went with something else. The median is on the track.
  assert.ok(Math.abs(mid.y - 0.52 * FRAME.h) < 1, `y ${mid.y}`);
});
