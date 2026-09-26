import type { GeoPosition } from "@/lib/location/coordinates";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";

/** Rough pins (a geocoded address or town) can sit a few km out, so "near" is town-sized. */
export const NEARBY_TRACK_RADIUS_M = 25_000;

/** "Find tracks near me" on the Tracks page: a browse radius, what you could race this weekend. */
export const NEARBY_BROWSE_RADIUS_M = 50_000;

export type TrackWithCoordinates = {
  id: string;
  name: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type TrackNearPosition = {
  track: TrackWithCoordinates;
  distanceM: number;
};

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: GeoPosition, b: GeoPosition): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function findTracksNearPosition(
  tracks: readonly TrackWithCoordinates[],
  position: GeoPosition,
  radiusMeters: number = NEARBY_TRACK_RADIUS_M
): TrackNearPosition[] {
  const withCoords = tracks.filter(trackHasMarkedLocation);
  const hits: TrackNearPosition[] = [];
  for (const track of withCoords) {
    const distanceM = haversineMeters(position, {
      latitude: track.latitude!,
      longitude: track.longitude!,
    });
    if (distanceM <= radiusMeters) {
      hits.push({ track, distanceM });
    }
  }
  return sortNearbyTracks(hits, []);
}

/** Favourites first, then by ascending distance within each group. */
export function sortNearbyTracks(
  nearby: readonly TrackNearPosition[],
  favouriteTrackIds: readonly string[] = []
): TrackNearPosition[] {
  const favSet = new Set(favouriteTrackIds);
  return [...nearby].sort((a, b) => {
    const aFav = favSet.has(a.track.id);
    const bFav = favSet.has(b.track.id);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return a.distanceM - b.distanceM;
  });
}
