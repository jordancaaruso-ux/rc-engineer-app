/**
 * Fill in the half of each candidate its source didn't carry.
 *
 *   LiveRC rows have an address but no pin   -> forward geocode
 *   OSM rows have an exact pin but no town   -> reverse geocode
 *
 * Uses Nominatim (OpenStreetMap), which is free and rate-limited to 1 request/second by their
 * usage policy — about 27 minutes for the full set. Every answer is cached to disk, so a re-run
 * costs nothing and only new candidates hit the network.
 *
 * THE IMPORTANT RULE: a forward geocode that only resolves to a town centre stores NO coordinates.
 * The app auto-selects a track when exactly one sits within 800m of the driver
 * (DEFAULT_TRACK_PROXIMITY_RADIUS_M), so a pin dropped in the middle of the wrong suburb would
 * silently attach runs to the wrong track. No pin is recoverable; a wrong pin is not.
 *
 *   npx tsx scripts/track-catalog/geocode-candidates.ts
 *   npx tsx scripts/track-catalog/geocode-candidates.ts --limit 20   # smoke test
 */
import fs from "node:fs";
import type { GeocodeCacheEntry, TrackCandidate } from "./candidateTypes";

const CANDIDATES = "seeds/track-catalog/candidates.json";
const CACHE = "seeds/track-catalog/geocode-cache.json";

const UA =
  "Trackside/1.0 (RC race-engineering app; one-off track catalog seed; contact: jordancaaruso@gmail.com)";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const RATE_LIMIT_MS = 1100; // their policy is 1/sec; leave headroom.

/**
 * Nominatim place_rank: country 4, state 8, city 16, suburb 20, street 26, building 30.
 * Below suburb the answer is a town centroid dressed up as an address — useless for a 800m
 * proximity check, and actively harmful if stored.
 */
const MIN_PLACE_RANK_FOR_A_PIN = 20;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const LIMIT = Number(arg("limit") ?? Infinity);

const doc = JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) as {
  candidates: TrackCandidate[];
  [k: string]: unknown;
};

const cache: Record<string, GeocodeCacheEntry> = fs.existsSync(CACHE)
  ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
  : {};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let requests = 0;

async function nominatim(pathAndQuery: string): Promise<unknown> {
  if (requests > 0) await sleep(RATE_LIMIT_MS);
  requests++;
  const res = await fetch(`${NOMINATIM}${pathAndQuery}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 429) {
    console.warn("  rate limited — backing off 30s");
    await sleep(30_000);
    return nominatim(pathAndQuery);
  }
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

type NominatimPlace = {
  lat: string;
  lon: string;
  place_rank?: number;
  addresstype?: string;
  address?: Record<string, string>;
};

function pickCity(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  return (
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.suburb ??
    address.hamlet ??
    address.county ??
    null
  );
}

/**
 * Strip what stops Nominatim finding a real address. Measured against the failures:
 * "204 Playa Della Rosita, Unit 10" returns nothing, "204 Playa Della Rosita" returns a rank-30
 * pin. Placeholder streets ("None Listed") are worse than useless — they poison the query.
 */
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

async function forwardGeocode(c: TrackCandidate): Promise<GeocodeCacheEntry> {
  const now = new Date().toISOString();
  const street = cleanStreet(c.street);

  /**
   * Attempts in order, first usable pin wins. The postcode is deliberately absent from all of
   * them: LiveRC postcodes are frequently wrong or placeholder ("0000000"), and including one
   * turns a good match into no match at all.
   */
  const attempts: { strategy: string; params: URLSearchParams; label: string }[] = [];

  if (street && c.city && c.countryName) {
    const structured = new URLSearchParams({
      street,
      city: c.city,
      country: c.countryName,
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
    });
    if (c.region) structured.set("state", c.region);
    attempts.push({ strategy: "structured", params: structured, label: `${street}, ${c.city}` });
  }

  const freeform = [street, c.city, c.region, c.countryName].filter(Boolean).join(", ");
  if (freeform) {
    attempts.push({
      strategy: "freeform",
      params: new URLSearchParams({ q: freeform, format: "jsonv2", addressdetails: "1", limit: "1" }),
      label: freeform,
    });
  }

  // Drop the region: a wrong state code ("Holen Hill SouthAust") blocks an otherwise findable street.
  const noRegion = [street, c.city, c.countryName].filter(Boolean).join(", ");
  if (noRegion && noRegion !== freeform) {
    attempts.push({
      strategy: "freeform-no-region",
      params: new URLSearchParams({ q: noRegion, format: "jsonv2", addressdetails: "1", limit: "1" }),
      label: noRegion,
    });
  }

  /**
   * Last resort: drop the house number and settle for the street.
   *
   * OSM often has the road but not the building — "10396 Route 9, Champlain NY" finds nothing
   * while "Route 9, Champlain NY" is a hit. A road centroid is a coarser pin, but it is coarse in
   * a safe direction: at worst the driver standing at the track is outside the 800m radius and
   * gets no suggestion, exactly as if there were no pin. A *town* centroid is the dangerous one
   * (it can sit near anything) and MIN_PLACE_RANK_FOR_A_PIN already refuses those.
   */
  const streetOnly = street?.replace(/^\s*\d+[a-z]?\s+/i, "").trim();
  if (streetOnly && streetOnly !== street && c.city && c.countryName) {
    const q = [streetOnly, c.city, c.region, c.countryName].filter(Boolean).join(", ");
    attempts.push({
      strategy: "street-only",
      params: new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "1" }),
      label: q,
    });
  }

  let coarsest: { hit: NominatimPlace; label: string } | null = null;

  for (const attempt of attempts) {
    const hits = (await nominatim(`/search?${attempt.params}`)) as NominatimPlace[];
    const hit = hits?.[0];
    if (!hit) continue;

    if ((hit.place_rank ?? 0) >= MIN_PLACE_RANK_FOR_A_PIN) {
      return {
        query: attempt.label,
        latitude: Number(hit.lat),
        longitude: Number(hit.lon),
        city: pickCity(hit.address) ?? c.city,
        region: hit.address?.state ?? c.region,
        countryCode: hit.address?.country_code ?? c.countryCode,
        strategy: attempt.strategy,
        precision: hit.addresstype ?? null,
        fetchedAt: now,
      };
    }
    coarsest = coarsest ?? { hit, label: attempt.label };
  }

  // Only a town centroid was found. Keep the town and country it confirms; refuse the pin.
  if (coarsest) {
    return {
      query: coarsest.label,
      latitude: null,
      longitude: null,
      city: pickCity(coarsest.hit.address) ?? c.city,
      region: coarsest.hit.address?.state ?? c.region,
      countryCode: coarsest.hit.address?.country_code ?? c.countryCode,
      strategy: "too-coarse",
      precision: coarsest.hit.addresstype ?? null,
      fetchedAt: now,
    };
  }

  return {
    query: freeform,
    latitude: null,
    longitude: null,
    city: c.city,
    region: c.region,
    countryCode: c.countryCode,
    strategy: "none",
    precision: null,
    fetchedAt: now,
  };
}

async function reverseGeocode(c: TrackCandidate): Promise<GeocodeCacheEntry> {
  const params = new URLSearchParams({
    lat: String(c.latitude),
    lon: String(c.longitude),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "14", // suburb/town level — we want the place name, not the building.
  });
  const hit = (await nominatim(`/reverse?${params}`)) as NominatimPlace | null;
  return {
    query: params.toString(),
    // The OSM pin is already exact; reverse geocoding must never move it.
    latitude: c.latitude,
    longitude: c.longitude,
    city: pickCity(hit?.address) ?? c.city,
    region: hit?.address?.state ?? null,
    countryCode: hit?.address?.country_code ?? c.countryCode,
    strategy: "reverse",
    precision: hit?.addresstype ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const todo = doc.candidates.filter((c) => c.needsGeocode !== null).slice(0, LIMIT);
  console.log(
    `${todo.length} candidates need a lookup (${Object.keys(cache).length} already cached)`
  );

  let done = 0;
  let fromCache = 0;
  let pinned = 0;
  let noPin = 0;

  for (const c of todo) {
    let entry = cache[c.key];
    if (entry) {
      fromCache++;
    } else {
      try {
        entry = c.needsGeocode === "reverse" ? await reverseGeocode(c) : await forwardGeocode(c);
      } catch (err) {
        console.warn(`  ${c.key}: ${String((err as Error).message)}`);
        continue;
      }
      cache[c.key] = entry;
      // Flush every time: 27 minutes of work should never be lost to one bad response.
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    }

    c.city = entry.city ?? c.city;
    c.region = entry.region ?? c.region;
    c.countryCode = entry.countryCode ?? c.countryCode;
    if (entry.latitude != null && entry.longitude != null) {
      c.latitude = entry.latitude;
      c.longitude = entry.longitude;
      c.coordinateSource = c.coordinateSource ?? "geocode";
      pinned++;
    } else {
      noPin++;
      if (!c.flags.includes("no-coordinates")) c.flags.push("no-coordinates");
    }
    if (entry.strategy === "too-coarse" && !c.flags.includes("geocode-too-coarse")) {
      c.flags.push("geocode-too-coarse");
    }
    c.needsGeocode = null;

    done++;
    if (done % 50 === 0) {
      console.log(
        `  ${done}/${todo.length}  (cached ${fromCache}, pinned ${pinned}, no pin ${noPin})`
      );
      fs.writeFileSync(CANDIDATES, JSON.stringify(doc, null, 1));
    }
  }

  // Re-flag now that city and country are known for the OSM rows.
  //
  // Must be idempotent, and must only judge rows that have actually been looked up: a `--limit`
  // smoke run would otherwise stamp "missing-city" on every OSM row it never got to, and those
  // flags would survive into the review queue as ~500 phantom problems.
  for (const c of doc.candidates) {
    if (c.source !== "osm") continue;
    c.flags = c.flags.filter((f) => f !== "missing-city" && f !== "unknown-country");
    if (c.needsGeocode !== null) continue; // not looked up yet — nothing to conclude
    if (!c.city) c.flags.push("missing-city");
    if (!c.countryCode) c.flags.push("unknown-country");
  }

  fs.writeFileSync(CANDIDATES, JSON.stringify(doc, null, 1));

  const withPin = doc.candidates.filter((c) => c.latitude != null).length;
  console.log(`done: ${done} processed, ${fromCache} from cache, ${requests} requests made`);
  console.log(`coordinates: ${withPin}/${doc.candidates.length} candidates have a usable pin`);
  console.log(`-> ${CANDIDATES}`);
  console.log(`-> ${CACHE}`);
}

void main();
