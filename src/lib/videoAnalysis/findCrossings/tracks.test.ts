/**
 * "Moves like a car" has to mean "moves unlike everything else", and a flicker that never moved
 * like anything must never become a mark on its own.
 *
 * The camera-shake case is built from the Boronia race of 2026-08-26, where three lines drawn over
 * painted kerbing reported crossings that were nothing but the whole frame nudging in the wind.
 */
import { frameMotions, trackCrossings, buildTracks, defaultTrackerConfig, type FrameObs } from "./tracks";
import { resultFromWindow } from "./detector";
import { reviewResults } from "./fromSession";
import { RECIPE_B22_T14, RECIPE_SEGMENT, type BandSample } from "./types";
import { bandHalfPxFor, lineGeom } from "./geometry";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cfg = defaultTrackerConfig(40);
const FPS = 30;
const dt = 1 / FPS;

/** A blob at (x, y); `signed` is its side of a vertical line at x = 500. */
const blob = (x: number, y: number) => ({ x, y, area: 30, signed: x - 500 });

/* ---------- camera shake: everything drifts together, nothing is a car ---------- */
{
  // Six patches of paint sit still, then the whole frame lurches +24px in x over four frames and
  // settles back. One of them straddles the line, so its sign flips — the classic false crossing.
  const rest = [420, 490, 560, 620, 680, 740];
  const lurch = [0, 0, 6, 12, 18, 24, 24, 18, 12, 6, 0, 0];
  const frames: FrameObs[] = lurch.map((d, f) => ({
    t: f * dt,
    blobs: rest.map((x, i) => blob(x + d, 100 + i * 40)),
  }));

  const motions = frameMotions(frames, cfg.maxSpeedPxPerSec * cfg.maxGapSec);
  assert(motions.length === frames.length - 1, "one motion per frame pair");
  const peak = Math.max(...motions.map((m) => Math.abs(m.dx)));
  assert(peak >= 5.9, `frame motion should see the lurch, peak dx=${peak}`);

  const tracks = buildTracks(frames, cfg);
  const without = trackCrossings(tracks, cfg, true, []);
  const withShake = trackCrossings(tracks, cfg, true, motions);
  assert(without.length >= 1, "without the background test, the lurch reads as a crossing");
  assert(withShake.length === 0, `with it, nothing crossed — got ${withShake.length}`);
}

/* ---------- a real car through a shaken frame still counts ---------- */
{
  // Same lurch, but one object drives steadily left-to-right THROUGH the line at 30px/frame while
  // the paint lurches +6/frame. Its own motion is most of its motion.
  const rest = [420, 560, 620, 680, 740];
  const lurch = [0, 0, 6, 12, 18, 24, 24, 18, 12, 6, 0, 0];
  const frames: FrameObs[] = lurch.map((d, f) => ({
    t: f * dt,
    blobs: [...rest.map((x, i) => blob(x + d, 100 + i * 40)), blob(325 + f * 30 + d, 300)],
  }));
  const motions = frameMotions(frames, cfg.maxSpeedPxPerSec * cfg.maxGapSec);
  const found = trackCrossings(buildTracks(frames, cfg), cfg, true, motions);
  assert(found.length === 1, `the car should still cross once, got ${found.length}`);
  assert(found[0]!.ownMotion != null && found[0]!.ownMotion >= 0.5, "its motion is its own");
}

/* ---------- one car, empty frame: no background, no penalty ---------- */
{
  const frames: FrameObs[] = Array.from({ length: 12 }, (_, f) => ({
    t: f * dt,
    blobs: [blob(325 + f * 30, 300)],
  }));
  const motions = frameMotions(frames, cfg.maxSpeedPxPerSec * cfg.maxGapSec);
  const found = trackCrossings(buildTracks(frames, cfg), cfg, true, motions);
  assert(found.length === 1, "a lone car on an empty band is still a crossing");
  assert(found[0]!.ownMotion == null, "nothing to compare against — judged as null, not as shake");
}

/* ---------- an untracked flicker is reported but never written ---------- */
{
  // Samples flip sign once with no blobs behind them: a frame-pair event with no track at all.
  const samples: BandSample[] = [
    { t: 0.0, signed: -8, x: 492, y: 100 },
    { t: dt, signed: -6, x: 494, y: 100 },
    { t: 2 * dt, signed: 5, x: 505, y: 100 },
    { t: 3 * dt, signed: 7, x: 507, y: 100 },
  ];
  const target = { id: "me:3:s1", lineKey: "s1", lapNumber: 3, centerSec: 0.05, truthSec: null };
  const r = resultFromWindow(target, samples, [], cfg);
  assert(r.source === "unconfirmed", `expected unconfirmed, got ${r.source}`);
  assert(r.detectedSec != null, "the flicker is still reported so it can be shown");

  const review = reviewResults({
    results: [{ ...r, id: target.id }],
    targets: [{ ...target, role: "me" }],
    marks: [],
    lapStarts: [{ role: "me", lapNumber: 3, videoTimeSec: 0 }],
    laps: [],
  });
  assert(review.found.length === 0, "an untracked flicker must not be written");
  assert(review.suspect.length === 1, "it is held back, still visible");
}

console.log("findCrossings tracks.test.ts OK");

/* ---------- a pass in the next lane is not a crossing of THIS line ---------- */
{
  // A hairpin at the far end of the track. The line is drawn across one lane — vertical, from
  // (500,100) to (500,200) — and a car goes past on the return lane 300px below it. It changes
  // sides of the line's DIRECTION exactly like the real thing, which is all the sign test sees.
  const line = { lineKey: "s4", label: "S4", sortOrder: 4, x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.2 };
  const frameW = 1000;
  const frameH = 1000;
  const geom = lineGeom(line, frameW, frameH);
  const returnLane: BandSample[] = [
    { t: 0.0, signed: -9, x: 491, y: 500 },
    { t: dt, signed: -4, x: 496, y: 500 },
    { t: 2 * dt, signed: 6, x: 506, y: 500 },
    { t: 3 * dt, signed: 11, x: 511, y: 500 },
  ];
  const target = { id: "me:3:s4", lineKey: "s4", lapNumber: 3, centerSec: 0.05, truthSec: null };

  const blind = resultFromWindow(target, returnLane, [], cfg);
  assert(blind.detectedSec != null, "without bounds the return lane reads as a crossing");

  const bounded = resultFromWindow(target, returnLane, [], cfg, {
    bounds: { geom, frameW, params: RECIPE_SEGMENT },
  });
  assert(bounded.detectedSec == null, "a flip 300px past the end of the line is not this corner");
  assert(bounded.offLineRejected === 1, `expected 1 rejected, got ${bounded.offLineRejected}`);

  // The car that really does cross, at the middle of the drawn line, still counts.
  const onIt = returnLane.map((s) => ({ ...s, y: 150 }));
  const real = resultFromWindow(target, onIt, [], cfg, {
    bounds: { geom, frameW, params: RECIPE_SEGMENT },
  });
  assert(real.detectedSec != null, "the real crossing survives the bound");
}

/* ---------- the band is a car wide wherever the line sits ---------- */
{
  const near = lineGeom({ lineKey: "sf", label: "SF", sortOrder: 0, x1: 0.2, y1: 0.5, x2: 0.5, y2: 0.5 }, 3840, 2160);
  const far = lineGeom({ lineKey: "s4", label: "S4", sortOrder: 4, x1: 0.5, y1: 0.3, x2: 0.51, y2: 0.3 }, 3840, 2160);
  const old = bandHalfPxFor(near, 3840, RECIPE_B22_T14);
  assert(old === bandHalfPxFor(far, 3840, RECIPE_B22_T14), "b22-t14 watches both at the same width");
  assert(
    bandHalfPxFor(far, 3840, RECIPE_SEGMENT) < bandHalfPxFor(near, 3840, RECIPE_SEGMENT),
    "the far line's band must be thinner than the near one's"
  );
  assert(
    bandHalfPxFor(near, 3840, RECIPE_SEGMENT) === old,
    "a line long enough to set its own scale keeps the frame-width band"
  );
}

console.log("findCrossings tracks.test.ts (segment bounds) OK");
