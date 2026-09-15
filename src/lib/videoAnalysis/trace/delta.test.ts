/**
 * The delta line says exactly how the second lap's clock was warped, and a hairpin does not fool
 * the projection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { consistencyCheck, deltaCurve, type LapPath } from "./delta";
import type { TracePoint, TraceSegment } from "@/lib/manualVideoAnalysis/types";

const ASPECT = 16 / 9;
const FPS = 30;

/** A path by lap fraction u in 0..1, in normalised frame coords. */
type Shape = (u: number) => { x: number; y: number };

const ellipse: Shape = (u) => ({
  x: 0.5 + 0.38 * Math.cos(2 * Math.PI * u),
  y: 0.5 + 0.35 * Math.sin(2 * Math.PI * u),
});

/** Out along a straight, round a tight hairpin, back beside the outbound leg 1.5% of the frame away. */
const hairpin: Shape = (u) => {
  if (u < 0.45) return { x: 0.1 + (0.8 * u) / 0.45, y: 0.4 };
  if (u < 0.55) {
    const a = ((u - 0.45) / 0.1) * Math.PI;
    return { x: 0.9 + 0.0075 * Math.sin(a), y: 0.4 + 0.0075 * (1 - Math.cos(a)) };
  }
  return { x: 0.9 - (0.8 * (u - 0.55)) / 0.45, y: 0.415 };
};

/** Invert a monotone warp numerically. */
function invert(f: (u: number) => number, target: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A lap sampled at 30fps: the car is at shape(u) at time start + clock(u). */
function lap(shape: Shape, start: number, clock: (u: number) => number, lines: number[]): LapPath {
  const lapSec = clock(1);
  const points: TracePoint[] = [];
  for (let t = 0; t <= lapSec + 1e-9; t += 1 / FPS) {
    const u = invert(clock, t);
    const p = shape(u);
    points.push([start + t, p.x, p.y, 0.02, 0.012]);
  }
  const keys = ["sf", ...lines.map((_, i) => `s${i + 1}`)];
  const segments: TraceSegment[] = [];
  const bounds = [0, ...lines, 1];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push({
      fromKey: keys[i] ?? "sf",
      toKey: keys[i + 1] ?? "sf",
      fromT: start + clock(bounds[i]!),
      toT: start + clock(bounds[i + 1]!),
      coverage: 1,
      anchorErr: { from: 0, to: 0 },
    });
  }
  return { points, startSec: start, endSec: start + lapSec, holes: [], segments };
}

const LINES = [0.25, 0.5, 0.75];

test("a lap warped by a known amount reads back as that warp, sign from your side", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  // Theirs: slower over the first half, quicker over the second, 0.3s slower over the lap.
  const warp = (u: number) => 17 * u + 0.6 * Math.sin(Math.PI * u) + 0.3 * u;
  const theirs = lap(ellipse, 400, warp, LINES);
  const curve = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  let worst = 0;
  for (const smp of curve.samples) {
    assert.notEqual(smp.delta, null, `a value at ${smp.s}`);
    // You minus them: at u, yours is 17u, theirs warp(u); the road is your path so s ↔ u exactly
    // only up to the ellipse's uneven arc length — so compare at the time your lap was there.
    const tb = curve.baseTimeOfS(smp.s)!;
    const u = (tb - 100) / 17;
    const expected = 17 * u - warp(u);
    worst = Math.max(worst, Math.abs(smp.delta! - expected));
  }
  assert.ok(worst < 0.012, `worst error ${worst.toFixed(4)}s`);
  assert.ok(curve.total != null && Math.abs(curve.total + 0.3) < 0.012, `total ${curve.total}`);
  assert.deepEqual(
    curve.ticks.map((t) => t.lineKey),
    ["s1", "s2", "s3", "sf"]
  );
});

test("the sign flips when the road is theirs", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17.4 * u, LINES);
  const onYours = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  const onTheirs = deltaCurve(theirs, yours, { aspect: ASPECT, baseIsYou: false });
  assert.ok(onYours.total != null && onYours.total < -0.38, `you are quicker: ${onYours.total}`);
  assert.ok(onTheirs.total != null && onTheirs.total < -0.38, `same answer from their road: ${onTheirs.total}`);
});

test("a hairpin's return leg does not steal the projection", () => {
  const yours = lap(hairpin, 100, (u) => 12 * u, [0.5]);
  const theirs = lap(hairpin, 300, (u) => 12.6 * u, [0.5]);
  const curve = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  // A stolen projection shows as the delta jumping by seconds; the honest one grows evenly.
  let prev: number | null = null;
  let worstJump = 0;
  for (const smp of curve.samples) {
    if (smp.delta == null) continue;
    if (prev != null) worstJump = Math.max(worstJump, Math.abs(smp.delta - prev));
    prev = smp.delta;
  }
  assert.ok(worstJump < 0.05, `worst step between samples ${worstJump.toFixed(3)}s`);
  assert.ok(curve.total != null && Math.abs(curve.total + 0.6) < 0.02, `total ${curve.total}`);
});

test("a hole on either lap is a gap in the curve, not a made-up value", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17 * u, LINES);
  theirs.holes = [{ fromT: 404, toT: 405, why: "lost" }];
  theirs.points = theirs.points.filter((p) => p[0] <= 404 || p[0] >= 405);
  const curve = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  const nulls = curve.samples.filter((s) => s.delta == null).length;
  assert.ok(nulls > 10 && nulls < 60, `about a second of the lap is a gap, got ${nulls} of ${curve.samples.length}`);
  const inside = curve.samples.filter((s) => {
    const t = curve.baseTimeOfS(s.s);
    return t != null && t > 104.1 && t < 104.9;
  });
  assert.ok(inside.every((s) => s.delta == null), "nothing is drawn across the hole");
});

test("the lap ends on the crossings, so the total is the lap-time difference", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17.5 * u, LINES);
  // Both traces stop a couple of frames before the line, as a real one does, and one of them
  // stops further short than the other — which is what biased the total before the ends were
  // carried out to the crossings.
  const trim = (l: LapPath, n: number) => ({ ...l, points: l.points.slice(0, -n) });
  const curve = deltaCurve(trim(yours, 2), trim(theirs, 5), { aspect: ASPECT, baseIsYou: true });
  assert.ok(curve.ticks.some((t) => t.lineKey === "sf" && t.s > 0.99), `a tick at the line: ${JSON.stringify(curve.ticks)}`);
  assert.ok(curve.total != null && Math.abs(curve.total + 0.5) < 0.005, `the lap's total delta: ${curve.total}`);
  assert.ok(Math.abs(curve.samples[0]!.delta ?? 9) < 0.005, "and it starts at zero");
});

test("a sector the tracer barely saw carries no delta", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17.5 * u, LINES);
  // Their second sector keeps one point in ten: a few dots, not a path.
  const seg = theirs.segments[1]!;
  const thin = {
    ...theirs,
    points: theirs.points.filter((p, i) => p[0] < seg.fromT || p[0] > seg.toT || i % 10 === 0),
    segments: theirs.segments.map((x, i) => (i === 1 ? { ...x, coverage: 0.1 } : x)),
  };
  const curve = deltaCurve(yours, thin, { aspect: ASPECT, baseIsYou: true });
  const inside = curve.samples.filter((smp) => {
    const t = curve.baseTimeOfS(smp.s);
    return t != null && t > 104.4 && t < 108.3;
  });
  assert.ok(inside.length > 5, "the second sector is sampled");
  assert.ok(inside.every((smp) => smp.delta == null), "and drawn as a gap");
});

test("a lap whose last second is a hole has no end", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17.5 * u, LINES);
  const cut = { ...theirs, points: theirs.points.filter((p) => p[0] < 416.5) };
  const curve = deltaCurve(yours, cut, { aspect: ASPECT, baseIsYou: true });
  assert.equal(curve.total, null);
});

test("the curve agrees with the board at every line, and a disagreement is named", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const warp = (u: number) => 17 * u + 0.4 * Math.sin(Math.PI * u);
  const theirs = lap(ellipse, 400, warp, LINES);
  const curve = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  const board = LINES.map((u, i) => ({ lineKey: `s${i + 1}`, youMinusThem: 17 * u - warp(u) }));
  const ok = consistencyCheck(curve, board, 0.08);
  assert.equal(ok.disagreeing.length, 0, JSON.stringify(ok.rows));
  const wrong = consistencyCheck(curve, [{ lineKey: "s2", youMinusThem: 1.5 }], 0.08);
  assert.equal(wrong.disagreeing.length, 1);
  assert.equal(wrong.disagreeing[0]!.lineKey, "s2");
});

/** The board's own cumulative delta at every line, from the two laps' crossings. */
function boardOf(yours: LapPath, theirs: LapPath) {
  return yours.segments.map((seg) => {
    const o = theirs.segments.find((x) => x.toKey === seg.toKey)!;
    return {
      lineKey: seg.toKey,
      youMinusThem: seg.toT - yours.startSec - (o.toT - theirs.startSec),
    };
  });
}

test("the curve reads every sector line off the crossings, not off the nearest point", () => {
  // Two laps round the same shape at different speeds, and one of them a metre wide of the other
  // all the way round — a different line through the same corners, which is what two drivers do.
  const wide: Shape = (u) => {
    const p = ellipse(u);
    return { x: 0.5 + (p.x - 0.5) * 1.06, y: 0.5 + (p.y - 0.5) * 1.06 };
  };
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(wide, 400, (u) => 17.4 * u + 0.4 * Math.sin(2 * Math.PI * u), LINES);
  const curve = deltaCurve(yours, theirs, { aspect: ASPECT, baseIsYou: true });
  // Nothing is asked of the line between the markers here; at the markers both laps' moments are
  // measured, so the reading is arithmetic and has to be exact.
  const check = consistencyCheck(curve, boardOf(yours, theirs), 0.001);
  assert.deepEqual(
    check.disagreeing.map((r) => r.lineKey),
    [],
    check.rows.map((r) => `${r.lineKey}:${r.diff?.toFixed(4)}`).join(" ")
  );
});

test("a path that runs on past the line reads right AT it and wrong without it", () => {
  const yours = lap(ellipse, 100, (u) => 17 * u, LINES);
  const theirs = lap(ellipse, 400, (u) => 17.4 * u, LINES);
  // Their path covers the whole second sector in half the time and then waits at the far end:
  // the shape of a chain that went with a car ahead and had to jump back to the crossing. It is
  // exactly what the Bendigo far sector did, 2026-09-07, and the sector board could not see it.
  const seg = theirs.segments[1]!;
  const posAt = (t: number) => {
    const p = theirs.points;
    const i = Math.max(0, Math.min(p.length - 1, p.findIndex((q) => q[0] >= t)));
    return p[i < 0 ? p.length - 1 : i]!;
  };
  const early = {
    ...theirs,
    points: theirs.points.map((p) => {
      if (p[0] <= seg.fromT || p[0] >= seg.toT) return p;
      const ahead = posAt(Math.min(seg.toT, seg.fromT + 2 * (p[0] - seg.fromT)));
      return [p[0], ahead[1], ahead[2], p[3], p[4]] as typeof p;
    }),
  };
  const board = boardOf(yours, early);
  // Pinned, the reading at s2 is two measured crossings subtracted and cannot be wrong.
  const pinned = consistencyCheck(
    deltaCurve(yours, early, { aspect: ASPECT, baseIsYou: true }),
    board,
    0.001
  ).rows.find((r) => r.lineKey === "s2")!;
  assert.ok(pinned.diff != null && Math.abs(pinned.diff) < 0.001, `pinned s2: ${pinned.diff}`);
  // Withheld, the projection has to find s2 from the pictures, and this path got there far too
  // early — so it either comes out wrong or refuses to read. Either is the harness working.
  const heldOut = consistencyCheck(
    deltaCurve(yours, early, { aspect: ASPECT, baseIsYou: true, dropCheckpoints: new Set(["s2"]) }),
    board,
    0.001
  ).rows.find((r) => r.lineKey === "s2")!;
  assert.ok(
    heldOut.diff == null || Math.abs(heldOut.diff) > 0.05,
    `withholding s2 changed nothing: ${heldOut.diff}`
  );
});
