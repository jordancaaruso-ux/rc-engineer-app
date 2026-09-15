/**
 * Fill `Track.timeZone` from each track's pin. Idempotent: only rows with a pin and no zone are
 * touched, so re-running after new tracks arrive is the intended use.
 *
 *   npm run db:backfill-track-tz          # whatever .env.local points at (scratch-dev)
 *
 * Against production this goes through prod-guard like every other db:* script. Tracks without
 * a pin stay null on purpose — the sweep falls back to the owner's zone for those.
 */
import { prisma } from "@/lib/prisma";
import { timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";

async function main() {
  const tracks = await prisma.track.findMany({
    where: { timeZone: null, latitude: { not: null }, longitude: { not: null } },
    select: { id: true, name: true, latitude: true, longitude: true },
    orderBy: { name: "asc" },
  });
  let set = 0;
  let unresolved = 0;
  for (const t of tracks) {
    const zone = timeZoneForCoordinates(t.latitude, t.longitude);
    if (!zone) {
      unresolved += 1;
      console.warn(`  ? ${t.name} (${t.id}) — pin gave no zone`);
      continue;
    }
    await prisma.track.update({ where: { id: t.id }, data: { timeZone: zone } });
    set += 1;
    console.log(`  ${t.name} → ${zone}`);
  }
  const withoutPin = await prisma.track.count({ where: { timeZone: null, latitude: null } });
  console.log(
    `\nSet ${set} of ${tracks.length} pinned tracks (${unresolved} unresolved). ${withoutPin} tracks have no pin and stay null.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
