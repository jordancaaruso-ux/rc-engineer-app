/**
 * Where to crop a driver's setup sheet so one changed box is the picture.
 *
 * ============================== WHY A PICTURE AT ALL ==============================
 *
 * On a chassis read off a PDF, "what changed since your last run" reads
 * "Box 47 · page 1, upper left: 4.5 → 5.0". To use that you have to go and count boxes on the
 * paper. But the sheet already has the answer printed beside every box — "CAMBER°", "DROOP (mm)" —
 * so showing the box where it sits says what changed without anyone having to name it first.
 *
 * ============================== WHY ONE CROP PER BOX ==============================
 *
 * The list is what a driver reads. The picture is what they open when the list is not enough — one
 * row at a time, from that row. So a crop answers one question: where is THIS on my sheet. It is
 * cut tight, because a crop that carries half a page has to be drawn big to stay readable, and a
 * stack of big pictures buried the list they were supposed to be helping.
 *
 * ============================== WHY IT IS ONLY ARITHMETIC ==============================
 *
 * Every box's position was stored as fractions of the page when the sheet was uploaded, and the
 * page picture is already rendered and cached. So a crop is a rectangle, worked out here, applied
 * with CSS. No PDF is opened and nothing is rendered per run — which is what makes this cheap
 * enough to sit on a run detail that a driver opens twenty times a day at a track.
 */

export type ChangedSheetBox = {
  key: string;
  pageNumber: number;
  /** Fractions of the page, from its top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type ChangedBoxCrop = {
  key: string;
  pageNumber: number;
  /** The part of the page to show, as fractions of the page. */
  crop: Rect;
  /** The box to ring, as fractions of THE CROP — which is what the markup positions against. */
  box: Rect;
};

/**
 * Room left around the changed box.
 *
 * Small on every side. The driver opened this crop from the row that names the parameter, so the
 * crop does not have to identify anything — it only has to show the spot. Extra room is not free:
 * a wider crop has to be drawn wider to stay readable, and the picture is meant to sit inside a
 * list without pushing it off the screen.
 */
const PAD_LEFT = 0.02;
const PAD_RIGHT = 0.02;
const PAD_TOP = 0.012;
const PAD_BOTTOM = 0.012;

/**
 * A crop never gets smaller than this, whatever the box measures.
 *
 * Some sheets store tick-boxes a couple of millimetres across. Cropped to themselves plus padding
 * those come out as a grey square with nothing around it, which reads as a broken image rather than
 * as a place on a sheet.
 */
const MIN_WIDTH = 0.06;
const MIN_HEIGHT = 0.03;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Grow a span to at least `min`, centred, then slide it back inside the page. */
function widen(start: number, end: number, min: number): { start: number; end: number } {
  const size = end - start;
  if (size >= min) return { start: clamp01(start), end: clamp01(end) };
  const grow = (min - size) / 2;
  let s = start - grow;
  let e = end + grow;
  if (s < 0) {
    e = Math.min(1, e - s);
    s = 0;
  }
  if (e > 1) {
    s = Math.max(0, s - (e - 1));
    e = 1;
  }
  return { start: s, end: e };
}

function cropFor(b: ChangedSheetBox): Rect {
  const h = widen(b.x - PAD_LEFT, b.x + b.width + PAD_RIGHT, MIN_WIDTH);
  const v = widen(b.y - PAD_TOP, b.y + b.height + PAD_BOTTOM, MIN_HEIGHT);
  return { x: h.start, y: v.start, width: h.end - h.start, height: v.end - v.start };
}

/**
 * A crop for each box that changed, in the order the keys were asked for.
 *
 * A key with no box on the sheet is skipped rather than reported: the caller is showing a list of
 * changes, and a change the sheet has no box for is still a change worth listing.
 */
export function changedBoxCrops(
  boxes: ReadonlyArray<ChangedSheetBox>,
  changedKeys: Iterable<string>
): ChangedBoxCrop[] {
  /*
   * A grouped parameter prints as several tick boxes sharing one key, and "where is this on my
   * sheet" for a choice row is the WHOLE row — the change is which of its boxes carries the mark,
   * so a crop of one arbitrary option would ring the wrong spot half the time. The row collapses
   * to the union of its boxes; a one-box parameter is a union of one, exactly as before.
   */
  const byKey = new Map<string, ChangedSheetBox>();
  for (const b of boxes) {
    const prev = byKey.get(b.key);
    if (!prev) {
      byKey.set(b.key, b);
      continue;
    }
    if (prev.pageNumber !== b.pageNumber) continue; // never stretch a crop across pages
    const x = Math.min(prev.x, b.x);
    const y = Math.min(prev.y, b.y);
    byKey.set(b.key, {
      key: b.key,
      pageNumber: prev.pageNumber,
      x,
      y,
      width: Math.max(prev.x + prev.width, b.x + b.width) - x,
      height: Math.max(prev.y + prev.height, b.y + b.height) - y,
    });
  }

  const out: ChangedBoxCrop[] = [];
  for (const key of changedKeys) {
    const b = byKey.get(key);
    if (!b) continue;
    const crop = cropFor(b);
    out.push({
      key,
      pageNumber: b.pageNumber,
      crop,
      box: {
        x: (b.x - crop.x) / crop.width,
        y: (b.y - crop.y) / crop.height,
        width: b.width / crop.width,
        height: b.height / crop.height,
      },
    });
  }
  return out;
}
