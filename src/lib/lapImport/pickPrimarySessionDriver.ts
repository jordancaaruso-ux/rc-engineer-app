import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import {
  liveRcNameMatchesConfigured,
  normalizeLiveRcDriverNameForMatch,
} from "@/lib/lapWatch/liveRcNameNormalize";

export type PickPrimarySessionDriverOpts = {
  liveRcDriverId: string | null;
  liveRcDriverName: string | null;
};

/**
 * Pick which timing row is "yours" for URL import defaults.
 * Prefers the stored LiveRC driver id, but only when the matched row's name also agrees —
 * the id is event-scoped and can collide across events, so a name mismatch defeats it.
 */
export function pickPrimarySessionDriver(
  drivers: LapUrlSessionDriver[],
  opts: PickPrimarySessionDriverOpts
): LapUrlSessionDriver {
  if (drivers.length === 0) {
    throw new Error("pickPrimarySessionDriver: empty drivers");
  }
  if (drivers.length === 1) {
    return drivers[0]!;
  }

  const nameWant = opts.liveRcDriverName?.trim()
    ? normalizeLiveRcDriverNameForMatch(opts.liveRcDriverName.trim())
    : "";

  // LiveRC `data-driver-id` is a per-event entry index, not a stable per-user id
  // (see resolveCanonicalLiveRcDriverId). A stored id from one event can collide with a
  // different driver's entry at another event, so only trust the id when the matched row's
  // name also matches — when a name is known. Fall back to name match otherwise.
  const idWant = opts.liveRcDriverId?.trim();
  if (idWant) {
    const byId = drivers.find((d) => d.driverId.trim() === idWant);
    if (byId && (!nameWant || liveRcNameMatchesConfigured(byId.driverName, nameWant))) {
      return byId;
    }
  }

  if (nameWant) {
    const byName = drivers.find((d) => liveRcNameMatchesConfigured(d.driverName, nameWant));
    if (byName) return byName;
  }

  return drivers[0]!;
}
