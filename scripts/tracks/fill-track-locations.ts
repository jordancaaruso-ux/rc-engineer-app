/**
 * Give existing tracks a pin from their timing site or town (founder 2026-09-17) — the one-off
 * catch-up for `fillTrackLocation`, which new tracks and newly added LiveRC links get on their own.
 *
 *   npm run tracks:fill-locations                       # dry run: what would be filled, and from where
 *   npm run tracks:fill-locations -- --apply            # write
 *   npm run tracks:fill-locations -- --apply --limit 20
 *
 * Points at whatever .env.local points at (scratch-dev since 2026-07-31) — the host is printed first.
 *
 * Catalog rows imported from LiveRC were already geocoded to street level in August
 * (seeds/track-catalog/geocode-cache.json); those pins are written straight from the cache. Every
 * other track goes through the live path: LiveRC's page, then Nominatim at one request a second,
 * so a few hundred tracks take a while. Never touches a pin set by hand or by drivers.
 */
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { fillTrackLocation } from "@/lib/tracks/trackLocationFill";
import { canReplacePin } from "@/lib/tracks/trackPinRules";
import { timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const CACHE = "seeds/track-catalog/geocode-cache.json";

type CacheEntry = { latitude: number | null; longitude: number | null };

function liveRcHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

async function main() {
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`Database: ${host}${APPLY ? "" : "  (dry run)"}`);

  const cache: Record<string, CacheEntry> = fs.existsSync(CACHE)
    ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
    : {};

  const tracks = await prisma.track.findMany({
    select: {
      id: true,
      name: true,
      location: true,
      liveRcUrl: true,
      latitude: true,
      longitude: true,
      locationSource: true,
    },
    orderBy: { name: "asc" },
  });

  const fromCache: { id: string; name: string; latitude: number; longitude: number }[] = [];
  const live: { id: string; name: string; via: string }[] = [];
  for (const t of tracks) {
    const lrcHost = liveRcHost(t.liveRcUrl);
    if (lrcHost && canReplacePin(t, "liverc_address")) {
      const hit = cache[`liverc:${lrcHost}`];
      if (hit?.latitude != null && hit.longitude != null) {
        fromCache.push({ id: t.id, name: t.name, latitude: hit.latitude, longitude: hit.longitude });
      } else {
        live.push({ id: t.id, name: t.name, via: "LiveRC address" });
      }
    } else if (t.location?.trim() && canReplacePin(t, "town")) {
      live.push({ id: t.id, name: t.name, via: `town "${t.location.trim()}"` });
    }
  }

  const alreadyPinned = tracks.filter((t) => t.latitude != null).length;
  console.log(`${tracks.length} tracks, ${alreadyPinned} already pinned`);
  console.log(`  ${fromCache.length} from the August LiveRC geocode (instant)`);
  console.log(`  ${live.length} to look up live (LiveRC page / typed town, ~1-6 s each)`);

  if (!APPLY) {
    for (const t of live.slice(0, 15)) console.log(`    ${t.name} — ${t.via}`);
    if (live.length > 15) console.log(`    … and ${live.length - 15} more`);
    return;
  }

  let written = 0;
  for (const t of fromCache) {
    const timeZone = timeZoneForCoordinates(t.latitude, t.longitude);
    // Same guard as the live path: only if the pin is still what we read.
    const current = tracks.find((x) => x.id === t.id)!;
    const { count } = await prisma.track.updateMany({
      where: {
        id: t.id,
        latitude: current.latitude,
        longitude: current.longitude,
        locationSource: current.locationSource,
      },
      data: {
        latitude: t.latitude,
        longitude: t.longitude,
        locationSource: "liverc_address",
        locationMarkedAt: new Date(),
        ...(timeZone ? { timeZone } : {}),
      },
    });
    written += count;
  }
  console.log(`Cache: wrote ${written} pins`);

  let done = 0;
  let filled = 0;
  for (const t of live.slice(0, LIMIT)) {
    const outcome = await fillTrackLocation(t.id);
    done++;
    if (outcome.filled) filled++;
    console.log(`  [${done}/${Math.min(live.length, LIMIT)}] ${outcome.filled ? outcome.source.padEnd(14) : "no pin".padEnd(14)} ${t.name}`);
  }
  console.log(`Live: ${filled} of ${done} got a pin`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
