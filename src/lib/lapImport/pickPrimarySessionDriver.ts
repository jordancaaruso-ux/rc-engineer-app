import type { LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

export type PickPrimarySessionDriverOpts = {
  liveRcDriverId: string | null;
  liveRcDriverName: string | null;
};

/**
 * Pick which timing row is "yours" for URL import defaults.
 * LiveRC race rows carry real `data-driver-id` values that match Settings → LiveRC driver ID.
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

  const idWant = opts.liveRcDriverId?.trim();
  if (idWant) {
    const byId = drivers.find((d) => d.driverId.trim() === idWant);
    if (byId) return byId;
  }

  const nameWant = opts.liveRcDriverName?.trim()
    ? normalizeLiveRcDriverNameForMatch(opts.liveRcDriverName.trim())
    : "";
  if (nameWant) {
    const byName = drivers.find((d) => normalizeLiveRcDriverNameForMatch(d.driverName) === nameWant);
    if (byName) return byName;
  }

  return drivers[0]!;
}
