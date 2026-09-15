/**
 * Your car is a colour — and on any ONE line it is the same colour every lap.
 *
 * The start-line reference (`carColour.ts`, learnt where the transponder names the car) has a
 * flaw the Bendigo 4K practice made plain (2026-09-09): a motion blob is the car mixed with
 * whatever is around it, and how much is car depends on how far from the camera the line sits.
 * The pink car read 0.49/0.31 at the start line, 0.40/0.32 pooled across the corners, and
 * 0.451/0.317 at S3 with a scatter of 0.002 over six laps. One reference for the whole track is
 * loose enough that it called a grey-blue flicker at S3's kerb end "yours"; a reference for S3
 * alone says the same flicker is 0.15 away — six times what "the same car" ever measures there.
 *
 * So each line gets its own reference, learnt from the crossings on that line where the driver
 * was plainly alone: a tracked, confirmed crossing with nothing else in the window. Three such
 * laps and a colour that is actually a colour (not the tarmac's grey, which every car reads as
 * from far enough away) is the bar; below it the line stays colour-blind, as it always was.
 *
 * With a reference, the review does two things and no more:
 *
 *  - a chosen crossing far from the driver's colour is SWAPPED for the candidate in the same
 *    window that matches it, when there is one — the car was on offer and lost to something
 *    nearer the prediction (Bendigo S3 laps 2 and 6: the kerb flicker 0.3s before the car);
 *  - the same, with nothing matching on offer, is HELD — shown, never written (lap 5: the car's
 *    own crossing was never a candidate, and the flicker went through as a sector time).
 *
 * Measured before it was built (scripts/tmp/own-colour-dryrun2.mts, 2026-09-10): over 267
 * picks on 29 usable driver-lines across the seven grading clips it touched seven rows — the
 * three S3 rows the eye truth calls wrong, and none the truth calls right.
 */
import {
  chromaDistance,
  chromaOf,
  referenceColour,
  toleranceFor,
  type CarColour,
  type Rgb,
} from "./carColour";
import type { CrossingEvent } from "./types";

/** The least a row needs to carry to be judged here — `RefinableResult` and `TrackedResult` both do. */
export type ColourRow = {
  id: string;
  lineKey: string;
  centerSec: number;
  detectedSec: number | null;
  quality: number | null;
  candidates: CrossingEvent[];
  source: "confirmed" | "rescued" | "unconfirmed" | null;
};

/** Fewest laps a driver must have crossed a line alone before that line has a reference. */
export const MIN_LINE_SAMPLES = 3;
/**
 * How far from grey a reference must sit before it can call anything "not this car". A grey
 * reference is the tarmac talking — every car far from the camera reads that way — and it would
 * refuse the very car it was meant to find the moment it caught some light. On the Bendigo
 * clips the pink car reads 0.04–0.05 from grey on the 1080p footage and 0.07–0.13 on the 4K.
 */
export const MIN_COLOURFUL = 0.06;
/** Never call a colour "not this car" nearer than this — 0.10 is a different colour of car. */
export const FAR_FLOOR = 0.1;
/** ...nor nearer than this many of the reference's own tolerances. */
export const FAR_TOLERANCE_MULTIPLE = 4;
/** A candidate this close to the row's time IS the row's pick. */
const SAME_TIME_SEC = 0.001;
/**
 * Beyond this many tolerances a colour is not the car, though not yet "far": the band a kerb's
 * red-brown reads in beside a pink car (`colourVerdict`'s "differs" starts here too).
 */
export const NOT_THE_CAR_MULTIPLE = 2;
/**
 * Two candidates this close are "about as near" the prediction, and between them the colour may
 * decide — the detector's own tiebreak distance. Bendigo S3 lap 14 (2026-09-10): the pick was a
 * red-brown flicker 0.22s after the pink car, in the band where nothing is far enough to refuse
 * outright; the car itself was on the list a fifth of a second earlier.
 */
export const TIEBREAK_SEC = 0.35;
const GREY = { rf: 1 / 3, bf: 1 / 3, lum: 0 };

export type LineColour = {
  role: string;
  lineKey: string;
  ref: CarColour;
  /** How far the reference sits from grey — its licence to say "not this car". */
  colourful: number;
};

/** Per `ownColourKey(role, lineKey)`. */
export type OwnColours = Map<string, LineColour>;

export function ownColourKey(role: string, lineKey: string): string {
  return `${role}|${lineKey}`;
}

/** The candidate a row's time came from, or null when the time is not one of its candidates. */
export function pickedOf(r: ColourRow): CrossingEvent | null {
  if (r.detectedSec == null) return null;
  let best: CrossingEvent | null = null;
  for (const c of r.candidates) {
    const d = Math.abs(c.t - r.detectedSec);
    if (d <= SAME_TIME_SEC && (!best || d < Math.abs(best.t - r.detectedSec))) best = c;
  }
  return best;
}

/**
 * Learn each driver's colour on each line from the laps where they crossed it alone.
 *
 * "Alone" is judged on everything the window saw — `candidatesOf` — not on what survived a
 * later filter: a second car crossing the other way is still a second car in the picture.
 */
export function learnOwnColours<T extends ColourRow>(
  rows: T[],
  sfKey: string,
  roleOf: (id: string) => string,
  candidatesOf: (r: T) => CrossingEvent[] = (r) => r.candidates
): OwnColours {
  const samples = new Map<string, { role: string; lineKey: string; colours: Rgb[] }>();
  for (const r of rows) {
    if (r.lineKey === sfKey || r.detectedSec == null || r.source !== "confirmed") continue;
    const seen = candidatesOf(r);
    if (seen.length !== 1) continue;
    const pick = pickedOf({ ...r, candidates: seen });
    if (!pick?.colour) continue;
    const role = roleOf(r.id);
    const key = ownColourKey(role, r.lineKey);
    const entry = samples.get(key) ?? { role, lineKey: r.lineKey, colours: [] };
    entry.colours.push(pick.colour);
    samples.set(key, entry);
  }
  const out: OwnColours = new Map();
  for (const [key, s] of samples) {
    if (s.colours.length < MIN_LINE_SAMPLES) continue;
    const ref = referenceColour(s.colours);
    if (!ref) continue;
    const colourful = chromaDistance(ref.chroma, GREY);
    if (colourful < MIN_COLOURFUL) continue;
    out.set(key, { role: s.role, lineKey: s.lineKey, ref, colourful });
  }
  return out;
}

/** Beyond this distance from the reference, a colour is not this car. */
export function farBar(ref: CarColour): number {
  return Math.max(FAR_FLOOR, FAR_TOLERANCE_MULTIPLE * toleranceFor(ref));
}

/**
 * What a line's reference says about one colour: inside its tolerance is this car, beyond the
 * far bar is not, and the band between says nothing — which is most of what a kerb reads as.
 */
export function lineColourVerdict(
  line: LineColour | undefined,
  colour: Rgb | undefined
): "yours" | "other" | undefined {
  if (!line || !colour) return undefined;
  const d = chromaDistance(line.ref.chroma, chromaOf(colour));
  if (d <= toleranceFor(line.ref)) return "yours";
  if (d >= farBar(line.ref)) return "other";
  return undefined;
}

export type ColourOutcome<T> = T & {
  /** Set when the pick was another colour and the car itself was on offer: where it came from. */
  colourSwap?: { fromSec: number; distance: number };
  /** Set when the pick was another colour and nothing on offer matched — held, not written. */
  colourHold?: { distance: number };
};

/**
 * Refuse each pick that is not the driver's colour on its line.
 *
 *  - Far from it (`farBar`): take the matching candidate nearest the prediction, anywhere in the
 *    window; hold the row when there is none.
 *  - Merely not it (beyond `NOT_THE_CAR_MULTIPLE` tolerances): take a matching candidate only
 *    when one sits within `TIEBREAK_SEC` — about as near the prediction, and the car; otherwise
 *    leave the pick alone, because that band is where kerbs and shadows read and a hold there
 *    would empty real rows.
 *
 * `fixed` rows — the lap starts and anything marked by hand — are never touched.
 */
export function repickByColour<T extends ColourRow>(
  rows: T[],
  own: OwnColours,
  sfKey: string,
  roleOf: (id: string) => string,
  fixed: ReadonlySet<string> = new Set()
): { rows: ColourOutcome<T>[]; swapped: string[]; held: string[] } {
  const swapped: string[] = [];
  const held: string[] = [];
  const out = rows.map((r): ColourOutcome<T> => {
    if (fixed.has(r.id) || r.lineKey === sfKey || r.detectedSec == null) return r;
    const line = own.get(ownColourKey(roleOf(r.id), r.lineKey));
    if (!line) return r;
    const pick = pickedOf(r);
    if (!pick?.colour) return r;
    const tol = toleranceFor(line.ref);
    const d = chromaDistance(line.ref.chroma, chromaOf(pick.colour));
    const far = d >= farBar(line.ref);
    if (!far && d <= NOT_THE_CAR_MULTIPLE * tol) return r;
    let best: CrossingEvent | null = null;
    for (const c of r.candidates) {
      if (c === pick || !c.colour) continue;
      if (chromaDistance(line.ref.chroma, chromaOf(c.colour)) > tol) continue;
      if (!far && Math.abs(c.t - pick.t) > TIEBREAK_SEC) continue;
      if (
        !best ||
        Math.abs(c.t - r.centerSec) < Math.abs(best.t - r.centerSec) ||
        (Math.abs(c.t - r.centerSec) === Math.abs(best.t - r.centerSec) && c.quality > best.quality)
      ) {
        best = c;
      }
    }
    if (best) {
      swapped.push(r.id);
      return {
        ...r,
        detectedSec: best.t,
        quality: best.quality,
        source: best.source ?? r.source,
        colourSwap: { fromSec: r.detectedSec, distance: d },
      };
    }
    if (!far) return r;
    held.push(r.id);
    return { ...r, colourHold: { distance: d } };
  });
  return { rows: out, swapped, held };
}
