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
  hits.sort((a, b) => a.distanceM - b.distanceM);
  return hits;
}

export function formatDistanceMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
