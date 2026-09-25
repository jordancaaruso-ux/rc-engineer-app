/**
 * What a tire is glued to — the `Run.tireFitment` value.
 *
 * An off-road tire never goes on the car alone: it is mounted on a wheel over an insert and
 * glued there for life, so "which tire" is really three products per end. A racer who also cuts
 * the insert or opens up the wheel's vent holes to soften the carcass for a surface wants that
 * on the record too.
 *
 * Founder rulings, 2026-09-19:
 *
 * - Insert and wheel are the driver's OWN list that remembers — free text typed once, then a tap
 *   from what they have used before (`recentFitmentValues`). Not a shared, reviewed catalog.
 *   Insert carries one ready-made answer, `STOCK_INSERT`, for the insert that came in the bag.
 * - `mods` is ONE free-text box per end, named "Modifications". Vent-hole size and count were
 *   proposed as number fields and turned down ("I don't want the holes inserts to be too
 *   specific") — a driver writes "3 extra holes, trimmed insert" in their own words. Do not add
 *   structured hole fields.
 *
 * Founder call, 2026-09-25: every class gets the boxes its own setup sheets ask for. Foam and
 * on-road front/rear classes (1/12, 1/10 pan, formula, 1/8 on-road) true their tires down, and
 * nearly every one of their manufacturers' sheets asks the DIAMETER of each end — so an end also
 * carries `diameterMm`. Which boxes a class shows is `TireProfile.boxes` (`tireProfile.ts`).
 *
 * Nothing here is ever required, and none of it decides whether the rubber changed: the tire's
 * own run count does that (`deriveTireStint.ts`). These values simply ride along — they carry to
 * the next run with the tire and stay put when the tire is swapped, because a driver who changes
 * tread nearly always mounts it on the same wheel and insert they always use. A diameter carries
 * too: the driver changes it when they true the tires.
 *
 * Pure, like `tirePrep.ts`: the form, both run routes and the read surfaces share one normaliser.
 */

export type TireFitmentEndKey = "front" | "rear";

export type TireFitmentEnd = {
  insert: string | null;
  wheel: string | null;
  /** Mounted diameter in millimetres, as trued. Foam and on-road front/rear classes. */
  diameterMm: number | null;
  /** Free text: insert modifications, vent holes — whatever the driver wants remembered. */
  mods: string | null;
};

export type TireFitment = {
  front?: TireFitmentEnd;
  rear?: TireFitmentEnd;
};

export const EMPTY_TIRE_FITMENT_END: TireFitmentEnd = {
  insert: null,
  wheel: null,
  diameterMm: null,
  mods: null,
};

/** A box an end can carry beside its tire, in the order the Tires step shows them. */
export type TireEndBox = "insert" | "wheel" | "diameter" | "mods";
export const TIRE_END_BOXES: readonly TireEndBox[] = ["insert", "wheel", "diameter", "mods"];

/** The insert that came with the tire. Always offered, so it is never listed among the recents. */
export const STOCK_INSERT = "Stock";

export const TIRE_FITMENT_NAME_MAX = 60;
export const TIRE_FITMENT_MODS_MAX = 200;

/**
 * Bounds for a mounted diameter. A trued 1/12 front sits near 38 mm and a 1/5 GT tire past
 * 110 mm; anything outside this is a typo (a width, or inches), and is dropped, not stored.
 */
export const TIRE_DIAMETER_MIN_MM = 10;
export const TIRE_DIAMETER_MAX_MM = 250;

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text || null;
}

/**
 * A diameter from a number or from what a driver typed: "42.5", "42,5" (a decimal comma), or
 * "42.5 mm". Kept to two decimals — a caliper reads to 0.01 mm. Null when blank or out of range.
 */
export function parseTireDiameterMm(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const text = raw.trim().replace(/\s*mm$/i, "").replace(",", ".");
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(text)) return null;
    n = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < TIRE_DIAMETER_MIN_MM || n > TIRE_DIAMETER_MAX_MM) return null;
  return Math.round(n * 100) / 100;
}

/** "42.5", "42", "41.25" — no trailing zeros, no unit. */
export function formatTireDiameterMm(mm: number): string {
  return String(Math.round(mm * 100) / 100);
}

function endBoxHasContent(end: TireFitmentEnd | null | undefined, box: TireEndBox): boolean {
  if (!end) return false;
  if (box === "diameter") return end.diameterMm != null;
  return Boolean(end[box]);
}

export function tireFitmentEndHasContent(end: TireFitmentEnd | null | undefined): boolean {
  return TIRE_END_BOXES.some((box) => endBoxHasContent(end, box));
}

/**
 * The boxes the Tires step shows: the ones the car's class asks for, plus any that already hold
 * a value. Data wins over the class, as it does for front/rear itself (`isSplitTireRun`): a run
 * that logged an insert keeps showing it even if its car has since been re-classed.
 */
export function tireEndBoxesToShow(
  classBoxes: readonly TireEndBox[],
  fitment: TireFitment | null | undefined
): TireEndBox[] {
  return TIRE_END_BOXES.filter(
    (box) =>
      classBoxes.includes(box) ||
      endBoxHasContent(fitment?.front, box) ||
      endBoxHasContent(fitment?.rear, box)
  );
}

export function tireFitmentHasContent(fitment: TireFitment | null | undefined): boolean {
  return tireFitmentEndHasContent(fitment?.front) || tireFitmentEndHasContent(fitment?.rear);
}

/** One end from anything — a request body, a stored row, a restored draft. Null when empty. */
export function normalizeTireFitmentEnd(raw: unknown): TireFitmentEnd | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const end: TireFitmentEnd = {
    insert: cleanText(rec.insert, TIRE_FITMENT_NAME_MAX),
    wheel: cleanText(rec.wheel, TIRE_FITMENT_NAME_MAX),
    diameterMm: parseTireDiameterMm(rec.diameterMm),
    mods: cleanText(rec.mods, TIRE_FITMENT_MODS_MAX),
  };
  return tireFitmentEndHasContent(end) ? end : null;
}

/**
 * The whole value, or null when there is nothing in it. An empty end is dropped rather than
 * stored as three nulls, and an empty object is never stored at all — the "own list" scan finds
 * its rows by the column being non-null, so a hollow `{}` would cost it a slot for nothing.
 */
export function normalizeTireFitment(raw: unknown): TireFitment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const front = normalizeTireFitmentEnd(rec.front);
  const rear = normalizeTireFitmentEnd(rec.rear);
  if (!front && !rear) return null;
  return { ...(front ? { front } : {}), ...(rear ? { rear } : {}) };
}

/** Set one end, keeping the other. Clearing an end's last value drops the end. */
export function withTireFitmentEnd(
  fitment: TireFitment | null | undefined,
  key: TireFitmentEndKey,
  end: TireFitmentEnd | null
): TireFitment {
  const next: TireFitment = { ...(fitment ?? {}) };
  if (end && tireFitmentEndHasContent(end)) next[key] = end;
  else delete next[key];
  return next;
}

/** "Dirt-Tech" reads as "Dirt-Tech insert"; "AKA red insert" is left as the driver wrote it. */
function withNoun(value: string, noun: "insert" | "wheel"): string {
  return new RegExp(`\\b${noun}s?\\b`, "i").test(value) ? value : `${value} ${noun}`;
}

/** One end in words, for a run page or a compare line. Null when nothing was entered. */
export function formatTireFitmentEnd(end: TireFitmentEnd | null | undefined): string | null {
  if (!end) return null;
  const parts = [
    end.insert ? withNoun(end.insert, "insert") : null,
    end.wheel ? withNoun(end.wheel, "wheel") : null,
    end.diameterMm != null ? `${formatTireDiameterMm(end.diameterMm)} mm diameter` : null,
    end.mods,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The driver's own list: distinct inserts and wheels from their recent runs, newest first.
 * `rows` are raw `Run.tireFitment` values in that order. Front and rear feed ONE list each — the
 * insert a driver runs in the rear is the first one they will reach for in the front. Matching is
 * case-insensitive and the first spelling seen (the most recent) is the one shown.
 */
export function recentFitmentValues(
  rows: readonly unknown[],
  limit = 8
): { inserts: string[]; wheels: string[] } {
  const inserts: string[] = [];
  const wheels: string[] = [];
  const seenInsert = new Set<string>([STOCK_INSERT.toLowerCase()]);
  const seenWheel = new Set<string>();
  const take = (value: string | null, seen: Set<string>, into: string[]) => {
    if (!value || into.length >= limit) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    into.push(value);
  };
  for (const row of rows) {
    const fitment = normalizeTireFitment(row);
    if (!fitment) continue;
    // Rear first: it is the end a driver fills in first-hand most often, so its spelling wins.
    for (const end of [fitment.rear, fitment.front]) {
      take(end?.insert ?? null, seenInsert, inserts);
      take(end?.wheel ?? null, seenWheel, wheels);
    }
    if (inserts.length >= limit && wheels.length >= limit) break;
  }
  return { inserts, wheels };
}
