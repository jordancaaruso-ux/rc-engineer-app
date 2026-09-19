/**
 * Does a recipe work on ANY video, or only on the one it was tuned against?
 *
 * `find-crossings-validate.ts` answers "is this faithful to the July run on IMG_4044" — one 4K
 * heat, one camera position, 15 hand marks. This answers the other question: hold the physics
 * fixed and vary everything a camera can vary — resolution, how far away the corner is, how fast
 * the car goes, how tight the track is — then ask whether the recipe still finds the car, still
 * times it, and still refuses the car in the next lane.
 *
 * Truth is known by construction (see `synthetic.ts`), so no marking and no footage is involved.
 *
 *   npx tsx scripts/find-crossings-generality.ts [recipe...]
 */

import { WindowScanner, resultFromWindow } from "../src/lib/videoAnalysis/findCrossings/detector";
import { renderScene, type Scene } from "../src/lib/videoAnalysis/findCrossings/synthetic";
import { RECIPE_VARIANTS, type DetectorParams, type SectorLine } from "../src/lib/videoAnalysis/findCrossings/types";

/** A corner as filmed: how big the car looks, how wide the track is, how fast it goes. */
type Case = {
  name: string;
  frameW: number;
  frameH: number;
  /** Apparent car length in frame pixels — the one number that says how far away this corner is. */
  carPx: number;
  /** Track width in car lengths. A 1/10 track is 8–12 cars wide. */
  trackCars: number;
  /** Car lengths travelled between frames. */
  carsPerFrame: number;
  fps: number;
  /** Line drawn along the diagonal instead of across the frame — cameras are rarely square on. */
  angled?: boolean;
};

const CASES: Case[] = [
  { name: "4K near straight", frameW: 3840, frameH: 2160, carPx: 90, trackCars: 9, carsPerFrame: 0.9, fps: 30 },
  { name: "4K mid corner", frameW: 3840, frameH: 2160, carPx: 34, trackCars: 9, carsPerFrame: 0.6, fps: 30 },
  { name: "4K far hairpin", frameW: 3840, frameH: 2160, carPx: 12, trackCars: 8, carsPerFrame: 0.5, fps: 30 },
  { name: "4K far hairpin, angled", frameW: 3840, frameH: 2160, carPx: 12, trackCars: 8, carsPerFrame: 0.5, fps: 30, angled: true },
  { name: "1080p near", frameW: 1920, frameH: 1080, carPx: 45, trackCars: 9, carsPerFrame: 0.9, fps: 30 },
  { name: "1080p mid", frameW: 1920, frameH: 1080, carPx: 17, trackCars: 9, carsPerFrame: 0.6, fps: 30 },
  { name: "1080p far hairpin", frameW: 1920, frameH: 1080, carPx: 8, trackCars: 8, carsPerFrame: 0.5, fps: 30 },
  { name: "720p phone, mid", frameW: 1280, frameH: 720, carPx: 14, trackCars: 9, carsPerFrame: 0.6, fps: 30 },
  { name: "1080p60 near, fast", frameW: 1920, frameH: 1080, carPx: 45, trackCars: 9, carsPerFrame: 0.5, fps: 60 },
  { name: "1080p30 near, very fast", frameW: 1920, frameH: 1080, carPx: 45, trackCars: 9, carsPerFrame: 1.8, fps: 30 },
];

const TRUE_SEC = 12.5;

function lineFor(c: Case): SectorLine {
  const lenPx = c.carPx * c.trackCars;
  const cx = c.frameW * 0.5;
  const cy = c.frameH * 0.5;
  const ang = c.angled ? Math.PI / 5 : Math.PI / 2; // across the frame, or leaning
  const dx = (Math.cos(ang) * lenPx) / 2;
  const dy = (Math.sin(ang) * lenPx) / 2;
  return {
    lineKey: "s1",
    label: "S1",
    sortOrder: 1,
    x1: (cx - dx) / c.frameW,
    y1: (cy - dy) / c.frameH,
    x2: (cx + dx) / c.frameW,
    y2: (cy + dy) / c.frameH,
  };
}

function scan(scene: Scene, params: DetectorParams): { detectedSec: number | null; candidates: number } {
  const clip = renderScene(scene);
  const scanner = new WindowScanner(scene.line, clip.roi, scene.frameW, scene.frameH, params, 3);
  for (const f of clip.frames) scanner.push(f.crop, f.t);
  const r = resultFromWindow(
    { id: "syn", lineKey: scene.line.lineKey, lapNumber: 1, centerSec: scene.trueSec, truthSec: scene.trueSec },
    scanner.samples,
    scanner.frames,
    scanner.trackerConfig,
    { bounds: scanner.bounds }
  );
  return { detectedSec: r.detectedSec, candidates: r.candidates.length };
}

const names = process.argv.slice(2);
const recipes = (names.length ? names : ["b22-t14", "segment", "seg-tight"]).map((n) => {
  const r = RECIPE_VARIANTS[n];
  if (!r) throw new Error(`unknown recipe ${n} — have: ${Object.keys(RECIPE_VARIANTS).join(", ")}`);
  return [n, r] as const;
});

for (const [name, params] of recipes) {
  console.log(`\n##### ${name}`);
  console.log(
    "  case".padEnd(30) +
      "middle".padEnd(12) +
      "at the tip".padEnd(14) +
      "next lane (must miss)".padEnd(24) +
      "past the end (must miss)"
  );
  let found = 0;
  let timed = 0;
  let refusedLane = 0;
  let refusedEnd = 0;
  for (const c of CASES) {
    const line = lineFor(c);
    const base = {
      frameW: c.frameW,
      frameH: c.frameH,
      line,
      carPx: c.carPx,
      speedPxPerFrame: c.carPx * c.carsPerFrame,
      fps: c.fps,
      trueSec: TRUE_SEC,
    };

    // 1. The ordinary case: a car through the middle of the line.
    const mid = scan({ ...base, crossAt: 0.5 }, params);
    // 2. The awkward one the end cap exists for: a car clipping the very end.
    const tip = scan({ ...base, crossAt: 0.03 }, params);
    // 3. The hairpin: only a car in the return lane, two car lengths beyond the end, going the
    //    other way. Nothing crosses the drawn line, so anything reported here is a false crossing.
    const lane = scan(
      { ...base, crossAt: 0.5, omitCar: true, distractorBeyondEndPx: c.carPx * 2 },
      params
    );
    // 4. A car crossing the line's own direction, but well past where it was drawn.
    const past = scan({ ...base, crossAt: 1.6 }, params);

    const ms = (r: { detectedSec: number | null }) =>
      r.detectedSec == null ? "MISS" : `${((r.detectedSec - TRUE_SEC) * 1000).toFixed(0)}ms`;

    if (mid.detectedSec != null) {
      found++;
      if (Math.abs(mid.detectedSec - TRUE_SEC) * 1000 <= 100) timed++;
    }
    if (lane.detectedSec == null) refusedLane++;
    if (past.detectedSec == null) refusedEnd++;

    console.log(
      `  ${c.name.padEnd(28)}${ms(mid).padEnd(12)}${ms(tip).padEnd(14)}` +
        `${(lane.detectedSec == null ? "refused ✓" : "REPORTED ✗").padEnd(24)}` +
        (past.detectedSec == null ? "refused ✓" : "REPORTED ✗")
    );
  }
  console.log(
    `  → found ${found}/${CASES.length} · timed within 100ms ${timed}/${CASES.length} · ` +
      `next lane refused ${refusedLane}/${CASES.length} · past the end refused ${refusedEnd}/${CASES.length}`
  );
}
