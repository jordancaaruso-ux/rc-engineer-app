/**
 * Two clocks, one subtraction: where a practice session sits on the video before anyone taps.
 *
 * A LiveRC practice page stamps the session's start to the second — the moment the transponder
 * first crossed the loop, which is exactly the crossing that starts lap 1 — and a phone stamps
 * its video with the moment recording began. The difference is the video time of that driver's
 * lap 1, good to about a second (the page rounds to whole seconds). Measured on the Bendigo
 * practice of 2026-08-30 (IMG_4521): three drivers placed by hand sat within 0.45s of this
 * arithmetic, and the fourth — placed by hand at 14.7s — was 35s off, which is why his whole
 * session came back with no sectors. The clock knew; nothing asked it.
 *
 * Practice only. A race page's stamp is the heat, not this driver's first crossing, and its lap 1
 * runs from a tone nobody can see on the footage; the race sync stays as it is.
 *
 * What comes out of here is a prediction, never an anchor: the start line still has to be seen
 * there (`confirmLapStarts` in `run.ts`), and a hand tap that disagrees with it by more than
 * `CLOCK_DISAGREE_SEC` is worth a line on the screen, not a refusal.
 */

import { realLaps } from "@/lib/videoAnalysis/findCrossings/fromSession";
import type { AnchorKind, ManualDriver, ManualTimingSession } from "./types";

/** A hand tap this far from the clock's answer is more likely a wrong crossing than a slow page. */
export const CLOCK_DISAGREE_SEC = 2.0;

/** A practice session: its first lap is a whole lap, timed from the first crossing of the loop. */
export function isPracticeTiming(driver: ManualDriver): boolean {
  const laps = [...driver.laps].filter((l) => l.lapTimeSec > 0).sort((a, b) => a.lapNumber - b.lapNumber);
  if (laps.length === 0) return false;
  return realLaps(laps).some((l) => l.lapNumber === laps[0]!.lapNumber);
}

/**
 * Video time at which this driver's lap 1 starts, from the two stamps — or null when either is
 * missing, the session is a race, or the answer is not on the video at all.
 */
export function predictedLapOneSec(
  ts: ManualTimingSession,
  driver: ManualDriver,
  recordedAtIso: string | null | undefined,
  durationSec?: number | null
): number | null {
  if (!ts.sessionCompletedAtIso || !recordedAtIso) return null;
  if (!isPracticeTiming(driver)) return null;
  const stamp = Date.parse(ts.sessionCompletedAtIso);
  const recorded = Date.parse(recordedAtIso);
  if (!Number.isFinite(stamp) || !Number.isFinite(recorded)) return null;
  const sec = (stamp - recorded) / 1000;
  // A little before the file starts is still worth a look (the page rounds); a session that
  // began minutes before the camera, or after it stopped, is not on this video.
  if (sec < -CLOCK_DISAGREE_SEC) return null;
  if (durationSec != null && sec > durationSec) return null;
  return sec;
}

/**
 * Where the clock puts one of this driver's crossings: the start of `lapNumber` (`sf_start`) or
 * its end (`sf_finish`), walked from the predicted lap 1.
 */
export function predictedCrossingSec(
  lapOneSec: number,
  driver: ManualDriver,
  lapNumber: number,
  anchorKind: AnchorKind
): number | null {
  const laps = [...driver.laps].sort((a, b) => a.lapNumber - b.lapNumber);
  let t = lapOneSec;
  for (const l of laps) {
    if (l.lapNumber >= lapNumber) break;
    t += l.lapTimeSec;
  }
  if (!laps.some((l) => l.lapNumber === lapNumber)) return null;
  if (anchorKind === "sf_finish") t += laps.find((l) => l.lapNumber === lapNumber)!.lapTimeSec;
  return t;
}
