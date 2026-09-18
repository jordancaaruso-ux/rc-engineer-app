import "server-only";

import type { GeoPosition } from "@/lib/location/coordinates";
import { prisma } from "@/lib/prisma";
import { timingUserAgent } from "@/lib/http/timingUserAgent";
import { BRAND_DOMAIN } from "@/lib/brand/brandNames";
import { extractLiveRcAddressLines, parseLiveRcAddress } from "@/lib/tracks/parseLiveRcAddress";
import { timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";
import {
  acceptSighting,
  addressGeocodeQueries,
  agreedPin,
  canReplacePin,
  MIN_PLACE_RANK_FOR_A_PIN,
  type AutoPinSource,
} from "@/lib/tracks/trackPinRules";

/**
 * Fills a track's pin without asking anyone (founder 2026-09-17): from the address LiveRC
 * publishes for the club, else from the town typed when the track was added, and later from two
 * drivers' phones agreeing (`recordTrackSighting`). Speedhive's club list carries no location,
 * so a Speedhive-only track gets its pin from the town or the phones.
 */

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
/** Their usage policy: at most one request a second, from an identifiable client. */
const NOMINATIM_GAP_MS = 1100;
let lastNominatimAt = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Geocoded = GeoPosition & { countryCode: string | null; region: string | null };

async function nominatim(params: URLSearchParams): Promise<Geocoded | null> {
  const wait = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();

  const query = new URLSearchParams(params);
  query.set("format", "jsonv2");
  query.set("addressdetails", "1");
  query.set("limit", "1");
  const res = await fetch(`${NOMINATIM_SEARCH}?${query}`, {
    headers: {
      "User-Agent": `JRCTrackside/1.0 (+https://www.${BRAND_DOMAIN}; track locations)`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const hits = (await res.json().catch(() => null)) as
    | { lat: string; lon: string; place_rank?: number; address?: Record<string, string> }[]
    | null;
  const hit = hits?.[0];
  if (!hit || (hit.place_rank ?? 0) < MIN_PLACE_RANK_FOR_A_PIN) return null;
  const latitude = Number(hit.lat);
  const longitude = Number(hit.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    countryCode: hit.address?.country_code?.toLowerCase() ?? null,
    region: hit.address?.state ?? null,
  };
}

/** The club's published address, geocoded. Null when the page, the address or the geocode fails. */
export async function geocodeLiveRcTrack(liveRcUrl: string): Promise<Geocoded | null> {
  let html: string;
  try {
    const res = await fetch(liveRcUrl, {
      headers: { "User-Agent": timingUserAgent(), Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const address = parseLiveRcAddress(extractLiveRcAddressLines(html));
  for (const params of addressGeocodeQueries(address)) {
    const hit = await nominatim(params).catch(() => null);
    if (hit) return { ...hit, countryCode: address.countryCode ?? hit.countryCode };
  }
  return null;
}

/** A typed town ("Knoxfield", "Adelaide SA"), geocoded — inside the track's country when known. */
export async function geocodeTown(town: string, countryCode?: string | null): Promise<Geocoded | null> {
  const q = town.trim();
  if (!q) return null;
  const params = new URLSearchParams({ q });
  if (countryCode) params.set("countrycodes", countryCode.toLowerCase());
  return nominatim(params).catch(() => null);
}

export type FillOutcome = { filled: false } | { filled: true; source: AutoPinSource };

/**
 * Give the track a pin from its timing site or town, if that beats the one it has. Safe to call
 * any time — after a create, after a LiveRC link is added, from the backfill script. Never
 * touches a pin set by hand or by drivers.
 */
export async function fillTrackLocation(trackId: string): Promise<FillOutcome> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      location: true,
      liveRcUrl: true,
      latitude: true,
      longitude: true,
      locationSource: true,
      countryCode: true,
      region: true,
    },
  });
  if (!track) return { filled: false };

  let found: { geo: Geocoded; source: AutoPinSource } | null = null;
  if (track.liveRcUrl && canReplacePin(track, "liverc_address")) {
    const geo = await geocodeLiveRcTrack(track.liveRcUrl);
    if (geo) found = { geo, source: "liverc_address" };
  }
  if (!found && track.location?.trim() && canReplacePin(track, "town")) {
    const geo = await geocodeTown(track.location, track.countryCode);
    if (geo) found = { geo, source: "town" };
  }
  if (!found) return { filled: false };

  const saved = await savePin(track, found.geo, found.source, {
    countryCode: track.countryCode ?? found.geo.countryCode,
    region: track.region ?? found.geo.region,
  });
  return saved ? { filled: true, source: found.source } : { filled: false };
}

type PinSnapshot = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
};

/**
 * Write the pin only if nobody changed it since we read it — a geocode takes seconds, and a
 * driver marking the track by hand in that window must win.
 */
async function savePin(
  track: PinSnapshot,
  pin: GeoPosition,
  source: AutoPinSource,
  extra: { countryCode?: string | null; region?: string | null } = {}
): Promise<boolean> {
  const timeZone = timeZoneForCoordinates(pin.latitude, pin.longitude);
  const { count } = await prisma.track.updateMany({
    where: {
      id: track.id,
      latitude: track.latitude,
      longitude: track.longitude,
      locationSource: track.locationSource,
    },
    data: {
      latitude: pin.latitude,
      longitude: pin.longitude,
      locationSource: source,
      locationMarkedAt: new Date(),
      ...(timeZone ? { timeZone } : {}),
      ...extra,
    },
  });
  return count > 0;
}

export type SightingOutcome = "ignored" | "kept" | "pinned";

/**
 * A driver just logged a run at this track with their phone's position to hand. Keep it as their
 * spot (one per driver per track, the latest); when another driver's spot agrees, that becomes
 * the pin and the track's spots are deleted. Spots are never shown to anyone.
 */
export async function recordTrackSighting(params: {
  userId: string;
  trackId: string;
  position: GeoPosition;
}): Promise<SightingOutcome> {
  const track = await prisma.track.findUnique({
    where: { id: params.trackId },
    select: { id: true, latitude: true, longitude: true, locationSource: true },
  });
  if (!track || !acceptSighting(track, params.position)) return "ignored";

  const { latitude, longitude } = params.position;
  await prisma.trackLocationSighting.upsert({
    where: { trackId_userId: { trackId: track.id, userId: params.userId } },
    create: { trackId: track.id, userId: params.userId, latitude, longitude },
    update: { latitude, longitude, createdAt: new Date() },
  });

  const others = await prisma.trackLocationSighting.findMany({
    where: { trackId: track.id, userId: { not: params.userId } },
    select: { userId: true, latitude: true, longitude: true },
  });
  const pin = agreedPin({ userId: params.userId, latitude, longitude }, others);
  if (!pin) return "kept";

  if (!(await savePin(track, pin, "drivers"))) return "kept";
  await prisma.trackLocationSighting.deleteMany({ where: { trackId: track.id } });
  return "pinned";
}
