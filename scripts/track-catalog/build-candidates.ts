/**
 * Join the two raw sources into one reviewable candidate list.
 *
 * Offline and deterministic on purpose — no network, no database. Re-running it is free, so the
 * flag rules and the activity window can be tuned and re-run in a second without re-sweeping
 * anything. Geocoding is deliberately NOT done here (see geocode-candidates.ts); this stage only
 * decides *which* tracks are candidates and *what we know* about them.
 *
 *   npx tsx scripts/track-catalog/build-candidates.ts
 *   npx tsx scripts/track-catalog/build-candidates.ts --today 2026-08-19 --months 12
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import { flagCandidate, normalizeTrackName, parseLiveRcAddress } from "./parseLiveRcAddress";
import type { TrackCandidate } from "./candidateTypes";

const RAW_DIR = "seeds/track-catalog/raw";
const OUT = "seeds/track-catalog/candidates.json";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const TODAY = arg("today") ?? new Date().toISOString().slice(0, 10);
const MONTHS = Number(arg("months") ?? 12);

/**
 * The activity window. Recency is the signal, NOT event count: a track posting 2 events but racing
 * last week is alive, while "50+ events" measures whether a club posts its club nights to LiveRC.
 * Measured on 2026-08-19: a 50-event floor would have dropped 513 still-active tracks, 507 of which
 * had raced within three months.
 */
function activityCutoff(today: string, months: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
const CUTOFF = activityCutoff(TODAY, MONTHS);

/** LiveRC's own site, not a track. Both come back with an empty <address>. */
const NOT_A_TRACK_HOST = /^(www|live)\.liverc\.com$/i;

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(path.join(RAW_DIR, file), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

type SweptTrack = {
  host: string;
  name?: string | null;
  title?: string | null;
  addressLines?: string[];
  website?: string | null;
  error?: string;
};

type SweptEvents = {
  host: string;
  eventCount?: number;
  firstEvent?: string | null;
  lastEvent?: string | null;
  error?: string;
};

type OsmExport = {
  attribution: string;
  tracks: {
    osmRef: string;
    name: string | null;
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    countryCode: string | null;
    website: string | null;
  }[];
};

const candidates: TrackCandidate[] = [];
const skipped: { ref: string; reason: string }[] = [];

// ---------------------------------------------------------------- LiveRC

const swept = readJsonl<SweptTrack>("liverc-tracks.jsonl");
const events = new Map(readJsonl<SweptEvents>("liverc-events.jsonl").map((e) => [e.host, e]));

for (const row of swept) {
  if (row.error || NOT_A_TRACK_HOST.test(row.host)) {
    skipped.push({ ref: row.host, reason: row.error ? "fetch-error" : "not-a-track" });
    continue;
  }

  const name = (row.name ?? row.title ?? "").trim();
  if (!name) {
    skipped.push({ ref: row.host, reason: "no-name" });
    continue;
  }

  const ev = events.get(row.host);
  const lastEvent = ev?.lastEvent ?? null;
  if (!lastEvent || lastEvent < CUTOFF) {
    skipped.push({ ref: row.host, reason: "inactive" });
    continue;
  }

  const address = parseLiveRcAddress(row.addressLines ?? []);

  // The subdomain IS the durable timing link. Run it through the app's own normaliser so the
  // value we store is byte-identical to what POST /api/tracks would have written.
  const liveRcUrl = normalizeLiveRcTrackOrigin(`https://${row.host}`);
  if (!liveRcUrl) {
    skipped.push({ ref: row.host, reason: "bad-origin" });
    continue;
  }

  candidates.push({
    key: `liverc:${row.host}`,
    source: "liverc",
    sourceRef: row.host,
    name,
    nameKey: normalizeTrackName(name),
    street: address.street,
    city: address.city,
    region: address.region,
    postcode: address.postcode,
    countryCode: address.countryCode,
    countryName: address.countryName,
    latitude: null,
    longitude: null,
    coordinateSource: null,
    liveRcUrl,
    website: row.website ?? null,
    eventCount: ev?.eventCount ?? 0,
    firstEvent: ev?.firstEvent ?? null,
    lastEvent,
    needsGeocode: "forward",
    flags: flagCandidate({
      name,
      city: address.city,
      countryCode: address.countryCode,
      postcode: address.postcode,
    }),
  });
}

// ---------------------------------------------------------------- OpenStreetMap

const osm = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "osm-rc-tracks.json"), "utf8")) as OsmExport;

for (const row of osm.tracks) {
  if (!row.name || row.latitude == null || row.longitude == null) {
    skipped.push({ ref: row.osmRef, reason: "osm-unnamed-or-unlocated" });
    continue;
  }

  // OSM coordinates are traced off aerial imagery, so they are exact — better than any geocode.
  // What OSM lacks is the town and country (tagged on only ~10% of rows), which is what the
  // reverse pass fills in.
  candidates.push({
    key: `osm:${row.osmRef}`,
    source: "osm",
    sourceRef: row.osmRef,
    name: row.name.trim(),
    nameKey: normalizeTrackName(row.name),
    street: null,
    city: row.city,
    region: null,
    postcode: null,
    countryCode: row.countryCode,
    countryName: null,
    latitude: row.latitude,
    longitude: row.longitude,
    coordinateSource: "osm",
    liveRcUrl: null,
    website: row.website,
    eventCount: 0,
    firstEvent: null,
    lastEvent: null,
    needsGeocode: row.city && row.countryCode ? null : "reverse",
    flags: flagCandidate({
      name: row.name.trim(),
      // City is expected to be missing before the reverse pass, so don't flag it here.
      city: "pending",
      countryCode: row.countryCode ?? "pending",
      postcode: null,
    }),
  });
}

// ------------------------------------------------- intra-set name collisions

// A LiveRC track and an OSM element can be the same physical place. Exact name collisions are
// caught here; the geographic ones need coordinates and are caught in match-existing.ts.
const byNameKey = new Map<string, TrackCandidate[]>();
for (const c of candidates) {
  const list = byNameKey.get(c.nameKey) ?? [];
  list.push(c);
  byNameKey.set(c.nameKey, list);
}
for (const [, group] of byNameKey) {
  if (group.length > 1) {
    for (const c of group) {
      c.flags.push("duplicate-name-in-set");
    }
  }
}

// ---------------------------------------------------------------- write

const bySource = { liverc: 0, osm: 0 };
const byCountry: Record<string, number> = {};
let flagged = 0;
for (const c of candidates) {
  bySource[c.source]++;
  const key = c.countryCode ?? "(pending)";
  byCountry[key] = (byCountry[key] ?? 0) + 1;
  if (c.flags.length > 0) flagged++;
}

const skipReasons: Record<string, number> = {};
for (const s of skipped) skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      today: TODAY,
      activityCutoff: CUTOFF,
      attribution: osm.attribution,
      counts: { total: candidates.length, bySource, flagged, skipped: skipped.length },
      skipReasons,
      candidates: candidates.sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    1
  )
);

console.log(`activity window: last ${MONTHS} months (event on or after ${CUTOFF})`);
console.log(`candidates: ${candidates.length}  (liverc ${bySource.liverc}, osm ${bySource.osm})`);
console.log(`flagged for review: ${flagged}`);
console.log(`skipped: ${skipped.length} ${JSON.stringify(skipReasons)}`);
console.log(
  `top countries: ${JSON.stringify(
    Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  )}`
);
console.log(`-> ${OUT}`);
