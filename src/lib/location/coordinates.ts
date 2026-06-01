export type GeoPosition = {
  latitude: number;
  longitude: number;
};

export function isValidLatitude(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLongitude(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

export function parseCoordinates(
  latitude: unknown,
  longitude: unknown
): GeoPosition | { error: string } {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return { error: "latitude and longitude must be numbers" };
  }
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return { error: "Invalid latitude or longitude" };
  }
  return { latitude, longitude };
}

export function trackHasMarkedLocation(track: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    track.latitude != null &&
    track.longitude != null &&
    isValidLatitude(track.latitude) &&
    isValidLongitude(track.longitude)
  );
}
