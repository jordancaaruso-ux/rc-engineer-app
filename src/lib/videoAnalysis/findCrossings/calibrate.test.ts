/**
 * The gate comes from the quietest clip, not the pooled sample.
 *
 * Bendigo, 2026-09-02: the browser's four calibration clips were spread across the session, and
 * two of them had a car sitting in the S5 band or the phone being picked up. Pooled, the 5th
 * percentile came out at 32 and the gate at 64; the harness's one quiet clip put it at 5. A far
 * car reading 15–24 fell under its own gate on every lap.
 */
import { calibrateFromClips, calibrateFromDiffs } from "./calibrate";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

/* ---------- two quiet clips and two busy ones: the quiet ones set the gate ---------- */
{
  const quiet = flat(36, 2);
  const busy = flat(36, 30);
  // Colour and brightness move together in the busy clips (a car, not colour noise), so the
  // verdict stays "colour" — the pooled ratio is what decides that, and it looks past traffic.
  const pooled = calibrateFromDiffs([...quiet, ...busy, ...quiet, ...busy], [...quiet, ...busy, ...quiet, ...busy]);
  assert(pooled.mode === "colour", "colour and brightness agree frame for frame: colour is kept");
  assert(pooled.thresh >= 8, `pooled: the floor at least, got ${pooled.thresh}`);

  const perClip = calibrateFromClips([quiet, busy, quiet, busy], [quiet, busy, quiet, busy]);
  assert(perClip.mode === "colour", "the verdict is the pooled one");
  assert(perClip.thresh === 8, `the quietest clip (2 → 4) sits under the floor of 8, got ${perClip.thresh}`);
  assert(perClip.colour?.quiet === 2, `quiet is the quietest clip's, got ${perClip.colour?.quiet}`);
}

/* ---------- every clip busy: the gate rises honestly ---------- */
{
  const busy = flat(36, 12);
  const c = calibrateFromClips([busy, busy], [busy, busy]);
  assert(c.thresh === 24, `twice a genuinely noisy band, got ${c.thresh}`);
}

/* ---------- brightness verdict uses the brightness floor ---------- */
{
  // Colour three times noisier than brightness everywhere: read brightness, gate from its quietest clip.
  const colourQuiet = flat(36, 6);
  const colourBusy = flat(36, 60);
  const lumaQuiet = flat(36, 1);
  const lumaBusy = flat(36, 20);
  const c = calibrateFromClips([colourBusy, colourQuiet], [lumaBusy, lumaQuiet]);
  assert(c.mode === "luma", `colour is noisier: brightness, got ${c.mode}`);
  assert(c.thresh === 5, `brightness floor 5 over a quiet 1, got ${c.thresh}`);
}

/* ---------- a clip too short to judge is ignored, and no clips at all falls back ---------- */
{
  const c = calibrateFromClips([[1, 2], flat(36, 3)], [[1, 1], flat(36, 1)]);
  assert(c.colour?.quiet === 3, `the two-frame clip says nothing, got ${c.colour?.quiet}`);
  const none = calibrateFromClips([], []);
  assert(none.reason.startsWith("not enough sample"), "no clips: the honest default");
}

console.log("calibrate.test.ts: OK");
