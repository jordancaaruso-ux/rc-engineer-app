/**
 * Speedhive practice sessions imported before the track's offset was kept (2026-09-17).
 *
 * The same-race rule reads every timing site on the track's own clock (`lapImport/trackClock.ts`).
 * Speedhive's practice loop sends a real instant, so a stored session needs the offset the track's
 * clock had when it ran. New imports keep it; these get it once, from a TRACK's zone only: the
 * session's own track, else the track of the run it is on, else the one track whose Speedhive link
 * is this practice location. Never a phone's zone — a guess written down stays wrong for good, and
 * that guess is exactly what the track's clock replaces. A session no track can place is left alone
 * and keeps being read in the phone's zone, as before.
 *
 * Idempotent: only practice sessions without an offset are touched.
 *
 *   npm run db:backfill-speedhive-offsets               # dry run — what it would write
 *   npm run db:backfill-speedhive-offsets -- --apply    # writes
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcOffsetMinutesInZone } from "@/lib/eventActive";
import {
  sessionCompletedAtIsoFromImportedPayload,
  sessionUtcOffsetMinutesFromImportedPayload,
} from "@/lib/lapImport/fromPayload";
import { isSpeedhiveRaceResultSession, timingSourceFromSourceUrl } from "@/lib/lapImport/labels";
import { parseSpeedhivePracticeLocationId } from "@/lib/speedhive/speedhivePracticeUrl";
import { isValidIanaTimeZone, timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";

type TrackZoneSource = { timeZone: string | null; latitude: number | null; longitude: number | null } | null;

function zoneOfTrack(track: TrackZoneSource): string | null {
  if (!track) return null;
  if (isValidIanaTimeZone(track.timeZone)) return track.timeZone.trim();
  return timeZoneForCoordinates(track.latitude, track.longitude);
}

const TRACK_SELECT = { timeZone: true, latitude: true, longitude: true } as const;

/** The zone of the tracks linked to this Speedhive practice location, when they agree on one. */
async function zoneOfPracticeLocation(locationId: number, cache: Map<number, string | null>): Promise<string | null> {
  if (cache.has(locationId)) return cache.get(locationId)!;
  const tracks = await prisma.track.findMany({
    where: { speedhiveUrl: { contains: `/practice/${locationId}` } },
    select: { speedhiveUrl: true, ...TRACK_SELECT },
  });
  const zones = new Set(
    tracks
      .filter((t) => parseSpeedhivePracticeLocationId(t.speedhiveUrl ?? "") === locationId)
      .map((t) => zoneOfTrack(t))
      .filter((z): z is string => z != null)
  );
  const zone = zones.size === 1 ? [...zones][0]! : null;
  cache.set(locationId, zone);
  return zone;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.importedLapTimeSession.findMany({
    where: {
      OR: [{ parserId: { contains: "speedhive" } }, { sourceUrl: { contains: "speedhive" } }],
    },
    select: {
      id: true,
      parserId: true,
      sourceUrl: true,
      sessionCompletedAt: true,
      parsedPayload: true,
      track: { select: TRACK_SELECT },
      linkedRun: { select: { track: { select: TRACK_SELECT } } },
    },
  });

  const counts = { practice: 0, alreadyKept: 0, set: 0, unplaced: 0, noTime: 0 };
  const from: Record<string, number> = {};
  const locationZones = new Map<number, string | null>();
  for (const row of rows) {
    const ref = { parserId: row.parserId, sourceUrl: row.sourceUrl };
    if (timingSourceFromSourceUrl(row.sourceUrl) !== "speedhive" || isSpeedhiveRaceResultSession(ref)) continue;
    counts.practice += 1;
    if (sessionUtcOffsetMinutesFromImportedPayload(row.parsedPayload) != null) {
      counts.alreadyKept += 1;
      continue;
    }
    const iso = row.sessionCompletedAt?.toISOString() ?? sessionCompletedAtIsoFromImportedPayload(row.parsedPayload);
    if (!iso) {
      counts.noTime += 1;
      continue;
    }

    const locationId = parseSpeedhivePracticeLocationId(row.sourceUrl);
    const candidates: Array<[string, () => Promise<string | null>]> = [
      ["session's track", async () => zoneOfTrack(row.track)],
      ["run's track", async () => zoneOfTrack(row.linkedRun?.track ?? null)],
      ["practice location's track", async () => (locationId ? zoneOfPracticeLocation(locationId, locationZones) : null)],
    ];
    let hit: [string, string] | null = null;
    for (const [label, read] of candidates) {
      const zone = await read();
      if (zone) {
        hit = [label, zone];
        break;
      }
    }
    if (!hit) {
      counts.unplaced += 1;
      console.log(`  ${row.id.slice(0, 10)}… ${iso} — no track to read the offset from; left to the phone's zone`);
      continue;
    }
    const [label, zone] = hit;
    const offset = utcOffsetMinutesInZone(zone, new Date(iso));
    from[label] = (from[label] ?? 0) + 1;
    counts.set += 1;
    console.log(`  ${row.id.slice(0, 10)}… ${iso} → ${zone} (${offset >= 0 ? "+" : ""}${offset} min, ${label})`);

    if (apply) {
      const payload =
        row.parsedPayload && typeof row.parsedPayload === "object" && !Array.isArray(row.parsedPayload)
          ? (row.parsedPayload as Record<string, unknown>)
          : {};
      await prisma.importedLapTimeSession.update({
        where: { id: row.id },
        data: { parsedPayload: { ...payload, sessionUtcOffsetMinutes: offset } as Prisma.InputJsonValue },
        select: { id: true },
      });
    }
  }

  console.log(
    `\n${apply ? "Wrote" : "Would write"} ${counts.set} of ${counts.practice} Speedhive practice sessions ` +
      `(${counts.alreadyKept} already kept their offset, ${counts.unplaced} with no track to read, ` +
      `${counts.noTime} with no time). Zones from: ${JSON.stringify(from)}` +
      (apply ? "" : "\nDry run — pass --apply to write.")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
