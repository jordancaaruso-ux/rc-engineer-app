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
 * Nothing here is ever required, and none of it decides whether the rubber changed: the tire's
 * own run count does that (`deriveTireStint.ts`). These values simply ride along — they carry to
 * the next run with the tire and stay put when the tire is swapped, because a driver who changes
 * tread nearly always mounts it on the same wheel and insert they always use.
 *
 * Pure, like `tirePrep.ts`: the form, both run routes and the read surfaces share one normaliser.
 */

export type TireFitmentEndKey = "front" | "rear";

export type TireFitmentEnd = {
  insert: string | null;
  wheel: string | null;
  /** Free text: insert modifications, vent holes — whatever the driver wants remembered. */
  mods: string | null;
};

export type TireFitment = {
  front?: TireFitmentEnd;
  rear?: TireFitmentEnd;
};

export const EMPTY_TIRE_FITMENT_END: TireFitmentEnd = { insert: null, wheel: null, mods: null };

/** The insert that came with the tire. Always offered, so it is never listed among the recents. */
export const STOCK_INSERT = "Stock";

export const TIRE_FITMENT_NAME_MAX = 60;
export const TIRE_FITMENT_MODS_MAX = 200;

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text || null;
}

export function tireFitmentEndHasContent(end: TireFitmentEnd | null | undefined): boolean {
  return Boolean(end && (end.insert || end.wheel || end.mods));
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
