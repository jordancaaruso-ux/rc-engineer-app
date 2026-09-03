/**
 * The clock must be measured, and it must not explain away a wrong car.
 *
 * Built from the Bendigo practice of 2026-09-01: the walked lap starts slid a second across nine
 * laps, mostly in one step, sector 1 absorbed all of it, and three laps of perfectly good
 * crossings were held as "odd" because they no longer clustered against that walk.
 */
import { clockDisagreements, correctedLapStarts, lapDrift } from "./lapClock";
import { flagImplausible, type RefinableResult } from "./refine";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const LINES = ["s1", "s2", "s3", "s4", "s5", "s6"];
/** Where each corner sits after a lap start, on every lap, for a driver who never varies. */
const OFFSET: Record<string, number> = { s1: 1.37, s2: 3.12, s3: 5.57, s4: 8.18, s5: 10.41, s6: 11.74 };
const LAP_SEC = 15;

/** One driver's session: laps 2..10, each lap's crossings offset by that lap's true drift. */
function session(driftOf: (lap: number) => number, mangle?: (lap: number, line: string) => number) {
  const results: RefinableResult[] = [];
  const walked = new Map<string, number>();
  for (let lap = 2; lap <= 10; lap++) {
    const walkStart = 100 + lap * LAP_SEC;
    walked.set(`me:${lap}`, walkStart);
    results.push({
      id: `me:${lap}:sf`,
      lineKey: "sf",
      lapNumber: lap,
      centerSec: walkStart,
      detectedSec: walkStart,
      quality: null,
      candidates: [],
      source: "confirmed",
    });
    for (const line of LINES) {
      results.push({
        id: `me:${lap}:${line}`,
        lineKey: line,
        lapNumber: lap,
        centerSec: walkStart + OFFSET[line]!,
        detectedSec: walkStart + OFFSET[line]! + driftOf(lap) + (mangle?.(lap, line) ?? 0),
        quality: 8,
        candidates: [],
        source: "confirmed",
      });
    }
  }
  return { results, walked };
}

const lapKey = (r: { id: string }) => r.id.split(":").slice(0, 2).join(":");

/* ---------- a walk that slides is measured, not believed ---------- */
{
  // The Bendigo shape: a slow slide, then a half-second step at lap 8 that never comes back.
  const trueDrift = (lap: number) => -0.05 * (lap - 2) - (lap >= 9 ? 0.55 : 0);
  const { results, walked } = session(trueDrift);
  const drift = lapDrift(results, walked, "sf", lapKey);

  // Drift is only ever measurable RELATIVE to the run itself: each line's usual offset is learned
  // from these same laps, so the middle of the session sits at zero by construction. What has to
  // be right is how the laps differ from each other — that difference is what poisons a sector
  // time, and only a detected start/finish can pin the absolute value.
  const base = drift.get("me:3")!.driftSec - trueDrift(3);
  for (let lap = 3; lap <= 9; lap++) {
    const d = drift.get(`me:${lap}`);
    assert(d != null, `no drift for lap ${lap}`);
    assert(
      Math.abs(d.driftSec - base - trueDrift(lap)) < 0.15,
      `lap ${lap}: measured ${(d.driftSec - base).toFixed(3)} vs true ${trueDrift(lap).toFixed(3)}`
    );
  }

  const fixed = correctedLapStarts(walked, drift);
  const step =
    fixed.get("me:9")! - walked.get("me:9")! - (fixed.get("me:8")! - walked.get("me:8")!);
  assert(
    Math.abs(step - (trueDrift(9) - trueDrift(8))) < 0.2,
    `the corrected starts must carry the sheet's bad lap: step ${step.toFixed(3)}`
  );

  // The point of it all: with the drift taken off, nothing is odd. Every lap is the same lap.
  const flagged = flagImplausible(results, "sf", lapKey);
  assert(flagged.size === 0, `a drifting clock must not make crossings odd — flagged ${flagged.size}`);
}

/* ---------- and a rival's whole lap is still caught ---------- */
{
  // No clock error at all; lap 7 is another car, a second early on every line. If the drift were
  // taken from that lap alone it would "explain" the whole lap and let it through.
  const { results, walked } = session(() => 0, (lap) => (lap === 7 ? -1.0 : 0));
  const drift = lapDrift(results, walked, "sf", lapKey);
  assert(
    Math.abs(drift.get("me:7")!.driftSec) < 0.2,
    `one lap out of step is a car, not a clock — got ${drift.get("me:7")!.driftSec.toFixed(3)}`
  );
  const flagged = flagImplausible(results, "sf", lapKey);
  assert(flagged.size >= LINES.length, `lap 7 should be held, flagged ${flagged.size}`);
  for (const line of LINES) assert(flagged.has(`me:7:${line}`), `lap 7 ${line} not held`);
}

/* ---------- lines that disagree with each other say nothing about the clock ---------- */
{
  // Half the lap early, half late: that lap's crossings cannot agree on where the lap sits.
  const { results, walked } = session(() => 0, (lap, line) =>
    lap === 5 ? (["s1", "s2", "s3"].includes(line) ? -0.9 : 0.9) : 0
  );
  const drift = lapDrift(results, walked, "sf", lapKey);
  assert(drift.get("me:5")!.rawSec == null, "a lap whose own lines disagree gives no drift");
}

/* ---------- the footage and the timing sheet are compared out loud ---------- */
{
  // Every lap 15s as filmed; the sheet says lap 8 took 15.55.
  const { results } = session(() => 0);
  const timed = (key: string) => (key === "me:8" ? 15.55 : LAP_SEC);
  const rows = clockDisagreements(results, timed, "sf", lapKey);
  assert(rows.length === 1, `expected one disagreement, got ${rows.length}`);
  assert(rows[0]!.lapKey === "me:8", `wrong lap: ${rows[0]!.lapKey}`);
  assert(Math.abs(rows[0]!.diffSec + 0.55) < 0.01, `expected -0.55s, got ${rows[0]!.diffSec}`);
  assert(rows[0]!.lines >= 2, "a disagreement needs more than one line behind it");
}

console.log("findCrossings lapClock.test.ts OK");
