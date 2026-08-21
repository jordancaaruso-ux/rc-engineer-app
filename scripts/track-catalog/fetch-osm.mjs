// One-off Overpass export of RC car tracks from OpenStreetMap.
//
// OSM is the EU half of the catalog: LiveRC covers the English-speaking world but barely exists in
// Europe, while OSM has ~448 named European RC tracks — and unlike a geocoded street address, an
// OSM element is a pin someone traced off aerial imagery, so the coordinates are exact.
//
// ODbL licensed: whatever we derive from this must carry "© OpenStreetMap contributors".
//
// Overpass is a free public endpoint. Run this once and commit the output; never call it from
// application code. Usage: node scripts/track-catalog/fetch-osm.mjs
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.argv[2] ?? "seeds/track-catalog/raw";
const OUT = path.join(OUT_DIR, "osm-rc-tracks.json");

const UA =
  "Trackside/1.0 (RC race-engineering app; one-off track directory export; contact: jordancaaruso@gmail.com)";

// `sport=rc_car` is the tag the RC community actually uses (~1,325 elements). The others are
// near-misses worth collecting so build-candidates can decide, rather than losing them silently.
// Deliberately NOT included: model_aerodrome (planes) and model_railway.
const QUERY = `[out:json][timeout:180];
(
  nwr["sport"="rc_car"];
  nwr["sport"="model_car"];
  nwr["sport"="model_car_racing"];
);
out tags center;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: {
    "User-Agent": UA,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "data=" + encodeURIComponent(QUERY),
});

if (!res.ok) {
  console.error(`Overpass returned HTTP ${res.status}`);
  process.exit(1);
}

const json = await res.json();
const elements = json.elements ?? [];

// Flatten to the shape build-candidates wants. `center` is present on ways/relations, lat/lon on
// nodes — collapse both to one pair so downstream never has to care which it was.
const rows = elements.map((el) => ({
  osmRef: `${el.type}/${el.id}`,
  name: el.tags?.name ?? null,
  latitude: el.lat ?? el.center?.lat ?? null,
  longitude: el.lon ?? el.center?.lon ?? null,
  sport: el.tags?.sport ?? null,
  city: el.tags?.["addr:city"] ?? null,
  countryCode: el.tags?.["addr:country"]?.toLowerCase() ?? null,
  website: el.tags?.website ?? el.tags?.["contact:website"] ?? null,
  operator: el.tags?.operator ?? null,
}));

const usable = rows.filter((r) => r.name && r.latitude != null && r.longitude != null);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      attribution: "© OpenStreetMap contributors (ODbL)",
      query: QUERY,
      totalElements: rows.length,
      usableCount: usable.length,
      tracks: rows,
    },
    null,
    1
  )
);

console.log(`Overpass: ${rows.length} elements, ${usable.length} named with coordinates`);
console.log(`-> ${OUT}`);
