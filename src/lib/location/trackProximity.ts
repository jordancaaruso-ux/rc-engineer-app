import type { GeoPosition } from "@/lib/location/coordinates";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";

export const DEFAULT_TRACK_PROXIMITY_RADIUS_M = 800;

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
  radiusMeters: number = DEFAULT_TRACK_PROXIMITY_RADIUS_M
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

export type TrackPickFromPositionResult =
  | { kind: "no_marked_tracks" }
  | { kind: "none_nearby" }
  | { kind: "single"; track: TrackWithCoordinates; distanceM: number }
  | { kind: "multiple"; nearby: TrackNearPosition[] };

/**
 * Decide how to set the track from device GPS: auto-select only when exactly one
 * track is within radius; otherwise return sorted nearby list for manual pick.
 */
export function pickTrackFromPosition(
  tracks: readonly TrackWithCoordinates[],
  position: GeoPosition,
  options?: {
    radiusMeters?: number;
    favouriteTrackIds?: readonly string[];
  }
): TrackPickFromPositionResult {
  const marked = tracks.filter(trackHasMarkedLocation);
  if (marked.length === 0) {
    return { kind: "no_marked_tracks" };
  }

  const radiusMeters = options?.radiusMeters ?? DEFAULT_TRACK_PROXIMITY_RADIUS_M;
  const favouriteTrackIds = options?.favouriteTrackIds ?? [];
  const nearby = sortNearbyTracks(
    findTracksNearPosition(tracks, position, radiusMeters),
    favouriteTrackIds
  );

  if (nearby.length === 0) {
    return { kind: "none_nearby" };
  }
  if (nearby.length === 1) {
    return {
      kind: "single",
      track: nearby[0]!.track,
      distanceM: nearby[0]!.distanceM,
    };
  }
  return { kind: "multiple", nearby };
}

export function formatDistanceMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
