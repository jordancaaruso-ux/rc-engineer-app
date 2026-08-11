/**
 * Where to crop a driver's setup sheet so the boxes that changed are the picture.
 *
 * ============================== WHY A PICTURE AT ALL ==============================
 *
 * On a chassis read off a PDF, "what changed since your last run" reads
 * "Box 47 · page 1, upper left: 4.5 → 5.0". To use that you have to go and count boxes on the
 * paper. But the sheet already has the answer printed beside every box — "CAMBER°", "DROOP (mm)" —
 * so showing the box where it sits says what changed without anyone having to name it first.
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

export type ChangedBoxRegion = {
  pageNumber: number;
  /** The part of the page to show, as fractions of the page. */
  crop: Rect;
  /** The boxes to ring, as fractions of THE CROP — which is what the markup positions against. */
  boxes: Array<{ key: string } & Rect>;
};

/**
 * Room left around the changed boxes.
 *
 * Far more on the left than anywhere else, because setup sheets print the caption to the LEFT of
 * the box it labels. A crop tight to the box shows a rectangle with a number in it and no way to
 * know what the number is — which is worse than showing nothing, because it looks like an answer.
 */
const PAD_LEFT = 0.17;
const PAD_RIGHT = 0.05;
const PAD_TOP = 0.035;
const PAD_BOTTOM = 0.035;

/**
 * A crop never gets smaller than this, whatever the boxes measure.
 *
 * One 2%-wide box padded by the numbers above still lands somewhere the driver has to orient
 * themselves in. A minimum keeps a recognisable chunk of the sheet — a whole corner block, a whole
 * damper column — so they can see where on the paper they are looking.
 */
const MIN_WIDTH = 0.34;
const MIN_HEIGHT = 0.16;

/** Past this the crop stops being a crop; show the page instead of pretending to have narrowed it. */
const FULL_PAGE_ABOVE = 0.88;

/**
 * Most pictures one page may be cut into.
 *
 * Beyond a handful, several little crops stop being easier to read than one wide one — the driver
 * is looking at a scattered sheet either way, and at that point showing the page whole at least
 * keeps everything in one frame.
 */
const MAX_REGIONS_PER_PAGE = 3;

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

type Bounds = { left: number; right: number; top: number; bottom: number };

function paddedBounds(b: ChangedSheetBox): Bounds {
  return {
    left: b.x - PAD_LEFT,
    right: b.x + b.width + PAD_RIGHT,
    top: b.y - PAD_TOP,
    bottom: b.y + b.height + PAD_BOTTOM,
  };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Changed boxes on one page, grouped into the pictures worth taking.
 *
 * Two changes at opposite ends of a sheet in one frame means a strip of page a few hundred pixels
 * wide and eighty tall, where nothing can be read — measured on the real Mugen sheet, which is what
 * sent this back for a second go. Boxes whose padded areas touch belong in one picture; boxes that
 * do not, get their own.
 */
function clusterOnPage(pageBoxes: ChangedSheetBox[]): Array<{ bounds: Bounds; boxes: ChangedSheetBox[] }> {
  const clusters: Array<{ bounds: Bounds; boxes: ChangedSheetBox[] }> = [];
  for (const box of pageBoxes) {
    clusters.push({ bounds: paddedBounds(box), boxes: [box] });
  }
  // Repeated passes, because merging two clusters can bring a third into reach of the result.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!overlaps(clusters[i]!.bounds, clusters[j]!.bounds)) continue;
        clusters[i] = {
          bounds: union(clusters[i]!.bounds, clusters[j]!.bounds),
          boxes: [...clusters[i]!.boxes, ...clusters[j]!.boxes],
        };
        clusters.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return clusters;
}

function toRegion(pageNumber: number, bounds: Bounds, boxes: ChangedSheetBox[]): ChangedBoxRegion {
  let { left, right, top, bottom } = bounds;
  ({ start: left, end: right } = widen(left, right, MIN_WIDTH));
  ({ start: top, end: bottom } = widen(top, bottom, MIN_HEIGHT));
  if (right - left > FULL_PAGE_ABOVE) {
    left = 0;
    right = 1;
  }
  if (bottom - top > FULL_PAGE_ABOVE) {
    top = 0;
    bottom = 1;
  }

  const crop: Rect = { x: left, y: top, width: right - left, height: bottom - top };
  return {
    pageNumber,
    crop,
    boxes: boxes.map((b) => ({
      key: b.key,
      x: (b.x - crop.x) / crop.width,
      y: (b.y - crop.y) / crop.height,
      width: b.width / crop.width,
      height: b.height / crop.height,
    })),
  };
}

/**
 * The pictures to show for a set of changed boxes: page by page, cluster by cluster, top to bottom.
 */
export function changedBoxRegions(
  boxes: ReadonlyArray<ChangedSheetBox>,
  changedKeys: Iterable<string>
): ChangedBoxRegion[] {
  const wanted = new Set(changedKeys);
  if (wanted.size === 0) return [];

  const byPage = new Map<number, ChangedSheetBox[]>();
  for (const b of boxes) {
    if (!wanted.has(b.key)) continue;
    byPage.set(b.pageNumber, [...(byPage.get(b.pageNumber) ?? []), b]);
  }

  const regions: ChangedBoxRegion[] = [];
  for (const [pageNumber, pageBoxes] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const clusters = clusterOnPage(pageBoxes);
    if (clusters.length > MAX_REGIONS_PER_PAGE) {
      // Scattered across the page: one picture of the whole page beats a wall of small ones.
      const whole = clusters.reduce((acc, c) => union(acc, c.bounds), clusters[0]!.bounds);
      regions.push(toRegion(pageNumber, whole, pageBoxes));
      continue;
    }
    clusters.sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
    for (const cluster of clusters) {
      regions.push(toRegion(pageNumber, cluster.bounds, cluster.boxes));
    }
  }
  return regions;
}
