/**
 * The no-review LiveRC catalog: name, timing link, town/state/country and a time zone. No pins.
 *
 * Founder call 2026-09-16. The full pipeline (review-server → import-catalog.ts) stalled on review:
 * ~650 of 1,619 candidates carried a problem and the first rows checked by hand were wrong —
 * mostly MAP PINS (8km-off geocodes, two sources disagreeing) and messy names. So this import
 * drops the risky half entirely:
 *
 *  - **No coordinates.** A wrong pin auto-selects the wrong track within 800m and silently files
 *    runs under it. No pin is harmless; the first driver at the venue sets the real one.
 *  - **Time zone from town/state/country** (geocode used only for the zone, never stored as a pin),
 *    because the timing sweep's "8 pm at this track" and "today at this track" read it, and a
 *    catalog row's owner has no zone to fall back to.
 *  - **Names tidied mechanically** (ALL CAPS / all lowercase only), never rewritten.
 *  - **Series and organisers are left out** (`NOT_A_VENUE`) — LiveRC gives them a host like a track.
 *  - **Existing tracks are never touched.** A candidate that looks like a track already in the
 *    catalog is skipped, not merged — a missed track is harmless, a wrong merge is not.
 *
 * Fully revertable: every row is `catalogSource = "liverc"`, owned by the catalog account.
 * `--revert` deletes each one nobody has used yet (no runs, events, favourites, layouts, videos,
 * imported sessions) and lists the ones that were adopted.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/import-liverc-names.ts            # dry run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/import-liverc-names.ts --apply
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/import-liverc-names.ts --revert
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "node:fs";
import tzlookup from "@photostructure/tz-lookup";
import { PrismaClient } from "@prisma/client";
import type { TrackCandidate } from "./candidateTypes";
import { normalizeTrackName } from "./parseLiveRcAddress";
import { tidyName, tidyPlace } from "../../src/lib/tracks/tidyTrackName";
import { GENERIC_WORDS } from "../../src/lib/speedhive/matchPracticeLocations";
import { demoCatalogUserId } from "../../src/lib/demo/demoAccess";
import { isThrowawayEmail } from "../../src/lib/account/throwawayAccounts";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

const CANDIDATES = "seeds/track-catalog/candidates.json";
const SYSTEM_EMAIL = "catalog@jrcdynamics.com";
const SYSTEM_NAME = "Track catalog";
const SOURCE = "liverc";
/** Same name this close to an existing track = the same venue. Only used when both have pins. */
const SAME_PLACE_M = 30_000;

// ---------------------------------------------------------------- names

/**
 * LiveRC hosts that belong to a race series or an event organiser rather than a venue: "Top Notch
 * Series", "2026 Florida Dirt Oval Series", "U.S. Indoor Champs". Measured 2026-09-16 against the
 * 1,075 active hosts — each hit read by hand; "PRW Special Events Center" is a venue and survives.
 */
const NOT_A_VENUE =
  /\b20\d\d\b|\bseries\b|championship|\bchamps\b|\bnationals\b|\btour\b|\bleague\b|grand prix|\bgp\b|\bevents\b(?!\s+cent)|nitro challenge|wicked weekend/i;

// ---------------------------------------------------------------- time zones

const US: Record<string, string> = {};
const usZones: [string, string[]][] = [
  ["America/New_York", ["CT", "DE", "DC", "FL", "GA", "KY", "ME", "MD", "MA", "NH", "NJ", "NY", "NC", "OH", "PA", "RI", "SC", "VT", "VA", "WV"]],
  ["America/Detroit", ["MI"]],
  ["America/Indiana/Indianapolis", ["IN"]],
  ["America/Chicago", ["AL", "AR", "IL", "IA", "KS", "LA", "MN", "MS", "MO", "NE", "ND", "OK", "SD", "TN", "TX", "WI"]],
  ["America/Denver", ["CO", "MT", "NM", "UT", "WY"]],
  ["America/Boise", ["ID"]],
  ["America/Phoenix", ["AZ"]],
  ["America/Los_Angeles", ["CA", "NV", "OR", "WA"]],
  ["America/Anchorage", ["AK"]],
  ["Pacific/Honolulu", ["HI"]],
  ["America/Puerto_Rico", ["PR"]],
];
for (const [zone, codes] of usZones) for (const code of codes) US[code] = zone;
const US_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
  "district of columbia": "DC",
};

const CA: Record<string, string> = {
  on: "America/Toronto", ontario: "America/Toronto", qc: "America/Toronto", quebec: "America/Toronto",
  bc: "America/Vancouver", "british columbia": "America/Vancouver",
  ab: "America/Edmonton", alberta: "America/Edmonton",
  sk: "America/Regina", saskatchewan: "America/Regina",
  mb: "America/Winnipeg", manitoba: "America/Winnipeg",
  ns: "America/Halifax", "nova scotia": "America/Halifax", nb: "America/Halifax",
  "new brunswick": "America/Halifax", pe: "America/Halifax", "prince edward island": "America/Halifax",
  nl: "America/St_Johns", "newfoundland and labrador": "America/St_Johns",
};

const AU: Record<string, string> = {
  nsw: "Australia/Sydney", "new south wales": "Australia/Sydney",
  act: "Australia/Sydney", "australian capital territory": "Australia/Sydney",
  vic: "Australia/Melbourne", victoria: "Australia/Melbourne",
  qld: "Australia/Brisbane", queensland: "Australia/Brisbane",
  sa: "Australia/Adelaide", "south australia": "Australia/Adelaide",
  wa: "Australia/Perth", "western australia": "Australia/Perth",
  tas: "Australia/Hobart", tasmania: "Australia/Hobart",
  nt: "Australia/Darwin", "northern territory": "Australia/Darwin",
};

/** The Australian rows LiveRC lists with a town but no state and no geocode (2026-09-16 set). */
const AU_TOWNS: Record<string, string> = {
  southaust: "Australia/Adelaide", adelaide: "Australia/Adelaide", "morphett vale": "Australia/Adelaide",
  "alice springs": "Australia/Darwin",
  "batemans bay": "Australia/Sydney", "albion park": "Australia/Sydney", castlereagh: "Australia/Sydney",
  sydney: "Australia/Sydney",
  bundaberg: "Australia/Brisbane", mackay: "Australia/Brisbane", rockhampton: "Australia/Brisbane",
  toowoomba: "Australia/Brisbane", glenview: "Australia/Brisbane",
  knoxfield: "Australia/Melbourne", mildura: "Australia/Melbourne", wodonga: "Australia/Melbourne",
  perth: "Australia/Perth",
};

/** Countries whose tracks sit in one zone (or, for mx/br/id/cl, overwhelmingly one). */
const COUNTRY: Record<string, string> = {
  gb: "Europe/London", ie: "Europe/Dublin", nz: "Pacific/Auckland", sg: "Asia/Singapore",
  cn: "Asia/Shanghai", hk: "Asia/Hong_Kong", tw: "Asia/Taipei", jp: "Asia/Tokyo", kr: "Asia/Seoul",
  ph: "Asia/Manila", my: "Asia/Kuala_Lumpur", bn: "Asia/Brunei", th: "Asia/Bangkok",
  vn: "Asia/Ho_Chi_Minh", id: "Asia/Jakarta", mn: "Asia/Ulaanbaatar", ae: "Asia/Dubai",
  om: "Asia/Muscat", il: "Asia/Jerusalem", az: "Asia/Baku", za: "Africa/Johannesburg",
  mx: "America/Mexico_City", br: "America/Sao_Paulo", ar: "America/Argentina/Buenos_Aires",
  cl: "America/Santiago", co: "America/Bogota", ve: "America/Caracas", cr: "America/Costa_Rica",
  hn: "America/Tegucigalpa", do: "America/Santo_Domingo", pr: "America/Puerto_Rico",
  tt: "America/Port_of_Spain", nl: "Europe/Amsterdam", be: "Europe/Brussels", se: "Europe/Stockholm",
  fi: "Europe/Helsinki", ee: "Europe/Tallinn", at: "Europe/Vienna", ch: "Europe/Zurich",
  it: "Europe/Rome", mt: "Europe/Malta", cz: "Europe/Prague", pl: "Europe/Warsaw",
  bg: "Europe/Sofia", is: "Atlantic/Reykjavik", de: "Europe/Berlin", fr: "Europe/Paris",
  es: "Europe/Madrid", dk: "Europe/Copenhagen", no: "Europe/Oslo",
};

function timeZoneFor(c: TrackCandidate): { zone: string | null; from: string } {
  if (c.latitude != null && c.longitude != null) {
    try {
      return { zone: tzlookup(c.latitude, c.longitude), from: "town" };
    } catch {
      // fall through to the tables
    }
  }
  const country = c.countryCode?.toLowerCase() ?? "";
  const region = c.region?.trim().toLowerCase() ?? "";
  if (country === "us" && region) {
    const code = region.length === 2 ? region.toUpperCase() : US_NAMES[region];
    if (code && US[code]) return { zone: US[code], from: "state" };
  }
  if (country === "ca" && CA[region]) return { zone: CA[region], from: "state" };
  if (country === "au" && AU[region]) return { zone: AU[region], from: "state" };
  if (country === "au") {
    const town = c.city?.trim().toLowerCase() ?? "";
    const hit = Object.entries(AU_TOWNS).find(([t]) => town.includes(t));
    if (hit) return { zone: hit[1], from: "town" };
  }
  if (COUNTRY[country]) return { zone: COUNTRY[country], from: "country" };
  return { zone: null, from: "none" };
}

// ---------------------------------------------------------------- matching existing tracks

function distinctiveWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}

/** Share of the shorter name's distinctive words found in the longer one. */
function containment(a: string, b: string): number {
  const wa = new Set(distinctiveWords(a));
  const wb = new Set(distinctiveWords(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let hits = 0;
  for (const w of small) if (large.has(w)) hits++;
  return hits / small.size;
}

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function liveRcHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- main

function dbHost(): string {
  return process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
}

async function revert(): Promise<void> {
  const system = await prisma.user.findUnique({ where: { email: SYSTEM_EMAIL } });
  if (!system) {
    console.log("No catalog account — nothing was imported.");
    return;
  }
  const rows = await prisma.track.findMany({
    where: { catalogSource: SOURCE, userId: system.id },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          runs: true,
          events: true,
          layouts: true,
          favouriteTracks: true,
          cameraProfiles: true,
          videoAssets: true,
          videoAnalysisJobs: true,
          importedLapTimeSessions: true,
        },
      },
    },
  });
  const unused = rows.filter((r) => Object.values(r._count).every((n) => n === 0));
  const adopted = rows.filter((r) => !unused.includes(r));
  console.log(`${APPLY ? "REVERT" : "REVERT DRY RUN"} — ${unused.length} unused rows to delete, ${adopted.length} adopted rows kept`);
  for (const r of adopted) console.log(`  kept (in use): ${r.name} ${JSON.stringify(r._count)}`);
  if (!APPLY) {
    console.log("\nNothing deleted. Re-run with --revert --apply.");
    return;
  }
  const ids = unused.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    await prisma.track.deleteMany({ where: { id: { in: ids.slice(i, i + 500) } } });
  }
  console.log(`Deleted ${ids.length}.`);
}

async function importRows(): Promise<void> {
  const doc = JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) as { candidates: TrackCandidate[] };
  const liverc = doc.candidates.filter((c) => c.source === SOURCE && c.liveRcUrl);

  // One venue listed under two LiveRC hosts: keep the one that raced most recently.
  const byVenue = new Map<string, TrackCandidate>();
  for (const c of liverc) {
    const key = `${normalizeTrackName(c.name)}|${(c.city ?? "").toLowerCase()}|${c.countryCode ?? ""}`;
    const held = byVenue.get(key);
    if (!held || (c.lastEvent ?? "") > (held.lastEvent ?? "")) byVenue.set(key, c);
  }
  const candidates = [...byVenue.values()];

  const demoId = demoCatalogUserId();
  const existing = (
    await prisma.track.findMany({
      // Not `NOT: { catalogSource: SOURCE }` — in SQL that also drops every NULL, i.e. every
      // track a driver created, which is exactly the set this has to avoid duplicating.
      where: { OR: [{ catalogSource: null }, { catalogSource: { not: SOURCE } }] },
      select: {
        id: true,
        name: true,
        location: true,
        latitude: true,
        longitude: true,
        liveRcUrl: true,
        userId: true,
        user: { select: { email: true } },
      },
    })
  ).filter((t) => t.userId !== demoId && !isThrowawayEmail(t.user.email));
  const existingHosts = new Set(existing.map((t) => liveRcHost(t.liveRcUrl)).filter(Boolean));

  const skipped: string[] = [];
  const plan: { c: TrackCandidate; name: string; location: string | null; zone: string | null }[] = [];
  const zoneFrom: Record<string, number> = {};
  for (const c of candidates) {
    if (NOT_A_VENUE.test(c.name)) {
      skipped.push(`  x ${c.name} — a race series or organiser, not a track`);
      continue;
    }
    if (existingHosts.has(c.sourceRef.toLowerCase())) {
      skipped.push(`  = ${c.name} — already in the catalog with this LiveRC link`);
      continue;
    }
    const twin = existing.find((t) => {
      if (containment(t.name, c.name) < 0.75) return false;
      if (t.latitude == null || t.longitude == null || c.latitude == null || c.longitude == null) return true;
      return metres({ lat: t.latitude, lon: t.longitude }, { lat: c.latitude, lon: c.longitude }) <= SAME_PLACE_M;
    });
    if (twin) {
      skipped.push(`  = ${c.name} (${c.city ?? "?"}) — looks like existing "${twin.name}" (${twin.location ?? "no location"})`);
      continue;
    }
    const city = c.flags?.includes("placeholder-city") ? null : tidyPlace(c.city);
    const region = tidyPlace(c.region);
    const location = [city, region].filter(Boolean).join(", ") || null;
    const { zone, from } = timeZoneFor(c);
    zoneFrom[from] = (zoneFrom[from] ?? 0) + 1;
    plan.push({ c, name: tidyName(c.name), location, zone });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${dbHost()}`);
  console.log(`LiveRC candidates ${liverc.length} → ${candidates.length} after folding same-venue hosts`);
  console.log(`create ${plan.length}   skip ${skipped.length} (series, or already in the catalog)`);
  console.log(`time zone from: ${JSON.stringify(zoneFrom)}`);
  const renamed = plan.filter((p) => p.name !== p.c.name);
  console.log(`\nnames tidied: ${renamed.length}`);
  for (const p of renamed) console.log(`  ${p.c.name}  →  ${p.name}`);
  console.log(`\nskipped:`);
  for (const s of skipped) console.log(s);
  const noZone = plan.filter((p) => !p.zone);
  if (noZone.length) {
    console.log(`\nno time zone (${noZone.length}) — first pin sets it:`);
    for (const p of noZone) console.log(`  ${p.name} — ${p.location ?? "?"} (${p.c.countryCode ?? "?"})`);
  }

  if (!APPLY) {
    console.log("\nNothing written. Re-run with --apply.");
    return;
  }

  const system =
    (await prisma.user.findUnique({ where: { email: SYSTEM_EMAIL } })) ??
    (await prisma.user.create({ data: { email: SYSTEM_EMAIL, name: SYSTEM_NAME } }));

  const now = new Date();
  const data = plan.map((p) => ({
    name: p.name,
    location: p.location,
    countryCode: p.c.countryCode,
    region: tidyPlace(p.c.region),
    timeZone: p.zone,
    liveRcUrl: p.c.liveRcUrl,
    catalogSource: SOURCE,
    catalogSourceRef: p.c.sourceRef,
    catalogEventCount: p.c.eventCount ?? null,
    verifiedAt: now,
    userId: system.id,
  }));
  let created = 0;
  for (let i = 0; i < data.length; i += 500) {
    const res = await prisma.track.createMany({ data: data.slice(i, i + 500), skipDuplicates: true });
    created += res.count;
  }
  console.log(`\nCreated ${created} (rows already imported are skipped, so re-running is safe).`);

  // Rows from an earlier run predate the event count — fill it in one statement.
  const refs = plan.map((p) => p.c.sourceRef);
  const counts = plan.map((p) => p.c.eventCount ?? 0);
  const filled = await prisma.$executeRaw`
    UPDATE "Track" AS t SET "catalogEventCount" = v.n
    FROM (SELECT unnest(${refs}::text[]) AS ref, unnest(${counts}::int[]) AS n) AS v
    WHERE t."catalogSource" = ${SOURCE} AND t."catalogSourceRef" = v.ref
      AND t."catalogEventCount" IS DISTINCT FROM v.n`;
  console.log(`Event counts filled on ${filled} existing rows.`);
  console.log("Undo: --revert (dry run) then --revert --apply.");
}

(REVERT ? revert() : importRows())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
