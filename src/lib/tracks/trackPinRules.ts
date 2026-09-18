import type { GeoPosition } from "@/lib/location/coordinates";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";
import { haversineMeters } from "@/lib/location/trackProximity";

/**
 * Where a track's pin comes from, and which source may replace which (founder 2026-09-17).
 *
 * Nothing selects a track from its pin any more — the pin only orders the picker, fetches weather
 * and names the track's time zone — so a pin a few km out is fine. That is what lets a pin come
 * from a timing site's address or a typed town instead of asking the driver to mark it.
 *
 *   town            the town typed when the track was added, geocoded      (roughest)
 *   liverc_address  the address LiveRC publishes for the club, geocoded
 *   drivers         two different drivers' phones, within 200 m of each other
 *   device / manual_paste / anything older   set by hand — never replaced automatically
 */
export type AutoPinSource = "town" | "liverc_address" | "drivers";

const AUTO_RANK: Record<AutoPinSource, number> = { town: 1, liverc_address: 2, drivers: 3 };
const HAND_SET_RANK = 4;

type PinState = {
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: string | null;
};

export function pinRank(track: PinState): number {
  if (!trackHasMarkedLocation(track)) return 0;
  const source = track.locationSource as AutoPinSource | null | undefined;
  return source && source in AUTO_RANK ? AUTO_RANK[source] : HAND_SET_RANK;
}

/** True when a pin from `incoming` is better than what the track has now. */
export function canReplacePin(track: PinState, incoming: AutoPinSource): boolean {
  return AUTO_RANK[incoming] > pinRank(track);
}

/** Two drivers' spots count as the same place inside this. */
export const SIGHTING_AGREE_RADIUS_M = 200;

/**
 * A phone further than this from an existing rough pin is not at the track (a driver logging
 * from home). Generous, because a LiveRC geocode can land several km out — the whole point of
 * the spots is to correct that.
 */
export const SIGHTING_MAX_FROM_PIN_M = 10_000;

/** Should this phone position be kept as a spot for the track? */
export function acceptSighting(track: PinState, position: GeoPosition): boolean {
  if (!canReplacePin(track, "drivers")) return false;
  if (!trackHasMarkedLocation(track)) return true;
  const distance = haversineMeters(position, {
    latitude: track.latitude!,
    longitude: track.longitude!,
  });
  return distance <= SIGHTING_MAX_FROM_PIN_M;
}

export type Sighting = GeoPosition & { userId: string };

/**
 * The pin two or more drivers agree on, or null. Only OTHER drivers' spots can agree with the new
 * one: one driver twice is one household, not a track (founder 2026-09-17). The pin is the middle
 * of every driver's spot inside the agreement radius of the new one.
 */
export function agreedPin(latest: Sighting, others: readonly Sighting[]): GeoPosition | null {
  const agreeing = others.filter(
    (s) => s.userId !== latest.userId && haversineMeters(latest, s) <= SIGHTING_AGREE_RADIUS_M
  );
  if (agreeing.length === 0) return null;
  const all = [latest, ...agreeing];
  return {
    latitude: all.reduce((sum, s) => sum + s.latitude, 0) / all.length,
    longitude: all.reduce((sum, s) => sum + s.longitude, 0) / all.length,
  };
}

export type AddressParts = {
  street: string | null;
  city: string | null;
  region: string | null;
  countryName: string | null;
};

/**
 * Nominatim queries for a published address, best first. Lessons from the catalog geocode
 * (scripts/track-catalog/geocode-candidates.ts): the postcode is never sent (LiveRC's are often
 * placeholders and poison the match), "Unit 10" is stripped, a wrong state can block a real
 * street, and OSM often knows the road but not the house number. The last query is the town
 * alone — rough, and rough is allowed.
 */
export function addressGeocodeQueries(address: AddressParts): URLSearchParams[] {
  const street = cleanStreet(address.street);
  const { city, region, countryName } = address;
  const queries: URLSearchParams[] = [];
  const seen = new Set<string>();
  const push = (params: Record<string, string>) => {
    const p = new URLSearchParams(params);
    const key = p.toString();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(p);
  };

  if (street && city && countryName) {
    push({ street, city, country: countryName, ...(region ? { state: region } : {}) });
  }
  const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");
  if (street) {
    push({ q: joined(street, city, region, countryName) });
    push({ q: joined(street, city, countryName) });
    const streetOnly = street.replace(/^\s*\d+[a-z]?\s+/i, "").trim();
    if (streetOnly && streetOnly !== street && city) {
      push({ q: joined(streetOnly, city, region, countryName) });
    }
  }
  if (city) push({ q: joined(city, region, countryName) });
  return queries;
}

function cleanStreet(street: string | null): string | null {
  if (!street) return null;
  if (/^\s*(none listed|none|n\/?a|unknown|private|tbd|\.)\s*$/i.test(street)) return null;
  const cleaned = street
    .replace(/,?\s*\b(unit|suite|ste\.?|apt\.?|bldg\.?|building|lot|#)\s*[a-z0-9-]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim();
  return cleaned || null;
}

/**
 * Nominatim place_rank: country 4, state 8, county 12, city 16, suburb 20, street 26, building 30.
 * A state or country centroid is hundreds of km out — worse than rough, so it is refused.
 */
export const MIN_PLACE_RANK_FOR_A_PIN = 12;
