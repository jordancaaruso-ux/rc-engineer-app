import { parseCoordinates, type GeoPosition } from "@/lib/location/coordinates";

export function parseCoordinatesPaste(input: string): GeoPosition | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "Paste coordinates from Google Maps (e.g. -37.75, 145.13)" };
  }
  const withoutParens = trimmed.replace(/[()]/g, "").trim();
  const commaParts = withoutParens.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const lat = Number(commaParts[0]);
    const lng = Number(commaParts[1]);
    return parseCoordinates(lat, lng);
  }
  const spaceParts = withoutParens.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    const lat = Number(spaceParts[0]);
    const lng = Number(spaceParts[1]);
    return parseCoordinates(lat, lng);
  }
  return { error: "Could not parse coordinates. Use format: latitude, longitude" };
}
