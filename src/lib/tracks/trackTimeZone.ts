import tzlookup from "@photostructure/tz-lookup";

/**
 * A track's clock. The timing sweep runs on a server: nobody's phone is there to say what day it
 * is at the venue, so "today's sessions at this track" and "8 pm at this track" both come from
 * here. Pure — the Prisma side (`ensureTrackTimeZone`) lives in `trackTimeZoneServer.ts`.
 */

export type TrackTimeZoneSource = {
  timeZone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type TrackTimeZoneOwner = { timeZone?: string | null } | null | undefined;

export const FALLBACK_TRACK_TIME_ZONE = "UTC";

/** True when `Intl` accepts the zone — the same test the `rc_tz` cookie sanitizer applies. */
export function isValidIanaTimeZone(raw: string | null | undefined): raw is string {
  const s = raw?.trim();
  if (!s) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/** IANA zone for a pin, or null when the coordinates are missing or the lookup refuses them. */
export function timeZoneForCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  try {
    const zone = tzlookup(latitude, longitude);
    return isValidIanaTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The zone to reason about a track in: its stored column, else its pin, else its owner's zone,
 * else UTC. Never throws, never returns an invalid zone.
 */
export function resolveTrackTimeZone(track: TrackTimeZoneSource, owner?: TrackTimeZoneOwner): string {
  if (isValidIanaTimeZone(track.timeZone)) return track.timeZone.trim();
  const fromPin = timeZoneForCoordinates(track.latitude, track.longitude);
  if (fromPin) return fromPin;
  if (isValidIanaTimeZone(owner?.timeZone)) return owner!.timeZone!.trim();
  return FALLBACK_TRACK_TIME_ZONE;
}
