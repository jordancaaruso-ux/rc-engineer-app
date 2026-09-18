import { normalizeSpeedhiveTransponderNumber } from "@/lib/speedhive/speedhiveTransponder";
import type { TransponderCarMap } from "@/lib/speedhive/transponderCars";

/**
 * "Has this chip moved?" (founder call 2026-09-17). A session found by a chip that joins a run the
 * driver logged BY HAND is the driver's own statement of which car the chip was in. Unpaired: pair
 * it. Paired with a different car: the chip has probably moved, so ask once — "In <car> now" /
 * "Still in <car>". A "still in" is remembered so the same chip and car never ask again.
 * Stored as one AppSetting: `{ pending: { chip, carId } | null, declined: ["<chip>:<carId>"] }`.
 */
export type ChipMovedState = {
  pending: { chip: string; carId: string } | null;
  declined: string[];
};

/** Every "still in" answer kept; old ones fall off so the setting cannot grow without end. */
const MAX_DECLINED = 40;

export function declinedKey(chip: string, carId: string): string {
  return `${chip}:${carId}`;
}

export function parseChipMovedSetting(raw: string | null | undefined): ChipMovedState {
  const empty: ChipMovedState = { pending: null, declined: [] };
  const text = raw?.trim();
  if (!text) return empty;
  try {
    const o = JSON.parse(text) as { pending?: unknown; declined?: unknown };
    const p = o.pending as { chip?: unknown; carId?: unknown } | null | undefined;
    const chip = typeof p?.chip === "string" ? normalizeSpeedhiveTransponderNumber(p.chip) : null;
    const carId = typeof p?.carId === "string" ? p.carId.trim() : "";
    return {
      pending: chip && carId ? { chip, carId } : null,
      declined: Array.isArray(o.declined) ? o.declined.filter((d): d is string => typeof d === "string") : [],
    };
  } catch {
    return empty;
  }
}

export function formatChipMovedSetting(state: ChipMovedState): string | null {
  const declined = state.declined.slice(-MAX_DECLINED);
  if (!state.pending && declined.length === 0) return null;
  return JSON.stringify({ pending: state.pending, declined });
}

/**
 * What a chip on a hand-logged run in `runCarId` teaches: `pair` (no usable pairing yet), `ask`
 * (paired with another car the driver still owns, and not already answered "still in"), or null.
 */
export function chipOnHandLoggedRun(input: {
  chip: string | null;
  runCarId: string | null;
  map: TransponderCarMap;
  userCarIds: readonly string[];
  declined: readonly string[];
}): "pair" | "ask" | null {
  const { chip, runCarId, map, userCarIds } = input;
  if (!chip || !runCarId || !userCarIds.includes(runCarId)) return null;
  const paired = map[chip];
  if (!paired || !userCarIds.includes(paired)) return "pair";
  if (paired === runCarId) return null;
  if (input.declined.includes(declinedKey(chip, runCarId))) return null;
  return "ask";
}

/** The pending question, only while it still means something: both cars owned, pairing still differs. */
export function livePendingChipQuestion(input: {
  state: ChipMovedState;
  map: TransponderCarMap;
  userCarIds: readonly string[];
}): { chip: string; carId: string; fromCarId: string } | null {
  const p = input.state.pending;
  if (!p) return null;
  const from = input.map[p.chip];
  if (!from || from === p.carId) return null;
  if (!input.userCarIds.includes(from) || !input.userCarIds.includes(p.carId)) return null;
  return { chip: p.chip, carId: p.carId, fromCarId: from };
}
