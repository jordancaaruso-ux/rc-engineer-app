/**
 * Which car is that? — the one thing timing and motion cannot answer.
 *
 * The detector finds movement and takes whatever moved nearest the line. It has never known one
 * car from another; the reason it usually picks yours is that it is only ever looking in the few
 * seconds where yours should be, taken from your own transponder times. That works until two cars
 * cross the same line within a few tenths of each other, and then nothing in the method notices
 * the swap.
 *
 * Your car, though, is a colour. So: at crossings we are certain about — the start/finish line,
 * where the transponder says exactly when you went through — read the colour of the thing that
 * moved, and remember it. From then on a blob of the wrong colour is not your car, however close
 * to the line it is.
 *
 * Two things make this honest rather than clever:
 *
 *  - A motion blob is not a clean picture of a car. It covers where the car was AND where it now
 *    is, so it always includes some track. The colour is therefore your car mixed with tarmac,
 *    which is fine as long as the SAME mixing happens in the reference — and it does, because the
 *    reference is measured the same way, off the same footage.
 *  - Brightness is deliberately thrown away before comparing. Sun, shadow and the far end of the
 *    track change how light a car looks far more than they change what colour it is, so the
 *    comparison runs on colour alone. That is also why this is worth doing at all when the motion
 *    detection itself now reads brightness only: the two use the picture for different jobs.
 *
 * Nothing here is trusted until it is measured on real footage — `separation()` reports whether
 * the colours actually tell the cars apart, and the gate stays off until they do.
 */

/** Mean colour of a moving blob, 0..255 per channel. */
export type Rgb = { r: number; g: number; b: number };

/**
 * Colour with brightness divided out: the two numbers that survive a car driving into shade.
 * Kept as plain fractions rather than a hue angle so that grey stays near the middle instead of
 * wrapping unpredictably.
 */
export type Chroma = { rf: number; bf: number; lum: number };

export function chromaOf(c: Rgb): Chroma {
  const sum = c.r + c.g + c.b;
  if (sum <= 0) return { rf: 1 / 3, bf: 1 / 3, lum: 0 };
  return { rf: c.r / sum, bf: c.b / sum, lum: sum / 3 };
}

/**
 * How different two colours are, 0 (identical) upward. Roughly: 0.02 is the same car under
 * different light, 0.10 is a different colour car.
 */
export function chromaDistance(a: Chroma, b: Chroma): number {
  return Math.hypot(a.rf - b.rf, a.bf - b.bf);
}

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export type CarColour = {
  /** The reference colour itself. */
  chroma: Chroma;
  /** How many certain crossings it was measured from. */
  samples: number;
  /** Typical scatter among those samples — the natural spread of one car across a session. */
  spread: number;
  /**
   * How far the OTHER cars seen at those same crossings sit from this reference, in units of its
   * own scatter — `separation()` of the rivals. Null when no rival was ever seen beside it. This
   * is the number that says whether colour can tell the cars apart on this footage; nothing
   * below decides anything on colour until it can.
   */
  separation?: number | null;
};

/** A reference whose rivals sit at least this many scatters away can decide between cars. */
export const USABLE_SEPARATION = 2;

/** Can this reference be trusted to say "not my car"? Never assumed — measured against rivals. */
export function colourUsable(
  ref: CarColour | null | undefined
): ref is CarColour & { separation: number } {
  return !!ref && ref.separation != null && ref.separation >= USABLE_SEPARATION;
}

export type ColourVerdict = "match" | "differs" | "unsure";

/**
 * What the reference says about one blob: inside the tolerance is a match, twice the tolerance
 * out is a different car, and the band between is honestly unsure.
 */
export function colourVerdict(ref: CarColour, blob: Rgb): ColourVerdict {
  const d = chromaDistance(ref.chroma, chromaOf(blob));
  const tol = toleranceFor(ref);
  return d <= tol ? "match" : d >= 2 * tol ? "differs" : "unsure";
}

/**
 * Build a reference from crossings we are sure about.
 *
 * Median, not mean: one crossing where another car clipped the frame should not tint the
 * reference, and with a handful of samples the median simply ignores it.
 */
export function referenceColour(samples: Rgb[]): CarColour | null {
  if (samples.length < 2) return null;
  const chromas = samples.map(chromaOf);
  const ref: Chroma = {
    rf: median(chromas.map((c) => c.rf)),
    bf: median(chromas.map((c) => c.bf)),
    lum: median(chromas.map((c) => c.lum)),
  };
  return {
    chroma: ref,
    samples: samples.length,
    spread: median(chromas.map((c) => chromaDistance(c, ref))),
  };
}

/**
 * Does this blob look like the reference car?
 *
 * The bar is set from the reference's own scatter rather than a fixed number, because a car
 * filmed across a whole session under moving cloud has a natural spread and a different track
 * will have a different one. Three times the observed spread, floored so that an unusually
 * consistent session does not produce an impossibly tight gate.
 */
const MIN_TOLERANCE = 0.025;
const SPREAD_MULTIPLE = 3;

export function toleranceFor(ref: CarColour): number {
  return Math.max(MIN_TOLERANCE, ref.spread * SPREAD_MULTIPLE);
}

export function matchesCar(ref: CarColour, blob: Rgb): boolean {
  return chromaDistance(ref.chroma, chromaOf(blob)) <= toleranceFor(ref);
}

/**
 * Can colour actually tell these apart on this footage?
 *
 * Returns how far the rejected group sits from the reference in units of the reference's own
 * scatter. Below about 2 the colours overlap and the gate would throw away real crossings; this
 * is the number that decides whether to switch it on, and it is reported rather than assumed.
 */
export function separation(ref: CarColour, others: Rgb[]): number | null {
  if (!others.length) return null;
  const d = others.map((o) => chromaDistance(ref.chroma, chromaOf(o)));
  return median(d) / Math.max(MIN_TOLERANCE / SPREAD_MULTIPLE, ref.spread);
}

/**
 * `separation` turned back into chroma: how far the other cars seen beside this one actually
 * sat from it — the footage's own measure of what "a different car" looks like. Null when none
 * were seen.
 */
export function rivalDistance(ref: CarColour): number | null {
  if (ref.separation == null) return null;
  return ref.separation * Math.max(MIN_TOLERANCE / SPREAD_MULTIPLE, ref.spread);
}
