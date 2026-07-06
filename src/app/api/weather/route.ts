import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isValidLatitude, isValidLongitude } from "@/lib/location/coordinates";
import { fetchRunConditionsFromOpenMeteo, WeatherFetchError } from "@/lib/weather/openMeteo";

/**
 * GET /api/weather?lat=&lon=&at=
 *
 * Server-side proxy to Open-Meteo so device/track coordinates never leave the
 * app's origin from the browser. `at` is an optional ISO instant (the session's
 * actual time); omitted = current weather. Returns normalized `RunConditions`.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return NextResponse.json({ error: "Valid lat and lon are required" }, { status: 400 });
  }

  const atRaw = searchParams.get("at");
  const atIso =
    atRaw && !Number.isNaN(new Date(atRaw).getTime()) ? atRaw : null;

  try {
    const conditions = await fetchRunConditionsFromOpenMeteo({
      latitude: lat,
      longitude: lon,
      atIso,
    });
    return NextResponse.json(
      { conditions },
      // Past-hour readings are immutable; even "now" changes slowly. Let the
      // CDN cache briefly to blunt repeated fetches while editing a run.
      { headers: { "Cache-Control": "private, max-age=600" } }
    );
  } catch (err) {
    const message =
      err instanceof WeatherFetchError ? err.message : "Weather lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
