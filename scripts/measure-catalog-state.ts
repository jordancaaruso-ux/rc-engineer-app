/**
 * Read-only snapshot of catalog + user state, to decide whether the asset-access moderation
 * work (review queue, merge, pre-seed) is warranted *now* or premature. Counts only — never writes.
 *
 * Run against PROD to get the real answer (dev data is unrepresentative):
 *   PowerShell:  $env:DATABASE_URL="<prod url>"; npx tsx scripts/measure-catalog-state.ts
 *   bash:        DATABASE_URL="<prod url>" npx tsx scripts/measure-catalog-state.ts
 * With no override it uses .env.local / .env (your dev Neon branch).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EARTH_RADIUS_M = 6_371_000;
const NEAR_M = 150;

function haversine(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Collapse punctuation/case so "Ronny's RC" and "Ronnys R/C" land in the same bucket. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clusters(names: string[]): { dupClusters: number; redundantRows: number } {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = normalize(n);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let dupClusters = 0;
  let redundantRows = 0;
  for (const c of counts.values()) {
    if (c > 1) {
      dupClusters += 1;
      redundantRows += c - 1;
    }
  }
  return { dupClusters, redundantRows };
}

async function main() {
  const [
    users,
    usersWithRuns,
    tireTotal,
    tireVerified,
    addTotal,
    addVerified,
    trackTotal,
    trackVerified,
    calTotal,
    calVerified,
    pendingChassis,
    runs,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.run.groupBy({ by: ["userId"] }).then((r) => r.length),
    prisma.tireType.count(),
    prisma.tireType.count({ where: { verifiedAt: { not: null } } }),
    prisma.additiveType.count(),
    prisma.additiveType.count({ where: { verifiedAt: { not: null } } }),
    prisma.track.count(),
    prisma.track.count({ where: { verifiedAt: { not: null } } }),
    prisma.setupSheetCalibration.count(),
    prisma.setupSheetCalibration.count({ where: { verifiedAt: { not: null } } }),
    prisma.chassisTypeRequest.count({ where: { resolvedAt: null } }),
    prisma.run.count(),
  ]);

  const tracks = await prisma.track.findMany({
    select: { id: true, name: true, latitude: true, longitude: true, userId: true },
  });
  const tireNames = (await prisma.tireType.findMany({ select: { displayName: true } })).map(
    (t) => t.displayName
  );

  const trackDup = clusters(tracks.map((t) => t.name));
  const tireDup = clusters(tireNames);

  const gpsTracks = tracks.filter(
    (t): t is typeof t & { latitude: number; longitude: number } =>
      t.latitude != null && t.longitude != null
  );
  let geoNearPairs = 0;
  for (let i = 0; i < gpsTracks.length; i++) {
    for (let j = i + 1; j < gpsTracks.length; j++) {
      if (haversine(gpsTracks[i]!, gpsTracks[j]!) <= NEAR_M) geoNearPairs++;
    }
  }

  const trackCreators = new Set(tracks.map((t) => t.userId)).size;

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);
  const line = (label: string, value: string | number) =>
    console.log(`  ${label.padEnd(34)} ${value}`);

  console.log("\n=== Catalog / user state ===\n");
  line("Users (total)", users);
  line("Users who have logged a run", `${usersWithRuns}  (of ${users})`);
  line("Runs (total)", runs);

  console.log("\n-- Verified coverage (verified / total) --");
  line("Tire types", `${tireVerified} / ${tireTotal}  (${pct(tireVerified, tireTotal)} verified)`);
  line("Additive types", `${addVerified} / ${addTotal}  (${pct(addVerified, addTotal)} verified)`);
  line("Tracks", `${trackVerified} / ${trackTotal}  (${pct(trackVerified, trackTotal)} verified)`);
  line("Calibrations", `${calVerified} / ${calTotal}  (${pct(calVerified, calTotal)} verified)`);

  console.log("\n-- Duplication signal (normalized: ignores case + punctuation) --");
  line("Track name dup-clusters", `${trackDup.dupClusters}  (${trackDup.redundantRows} redundant rows)`);
  line("Tire name dup-clusters", `${tireDup.dupClusters}`);
  line("Tracks with GPS marked", `${gpsTracks.length} / ${trackTotal}`);
  line("GPS track pairs within 150m", `${geoNearPairs}  (likely same-venue dups)`);
  line("Distinct track creators", trackCreators);

  console.log("\n-- Moderation load --");
  line("Pending chassis requests", pendingChassis);
  line("Unverified rows total", tireTotal - tireVerified + (addTotal - addVerified) + (trackTotal - trackVerified) + (calTotal - calVerified));

  console.log("\nReading: if users≈1 and dup-clusters≈0, the moderation infra is ahead of demand.");
  console.log("If dup-clusters>0 already, run scripts/dedupe-* before the wide release.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
