/**
 * Dev only: the driver-vs-driver sector compare for one job, as numbers.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-driver-compare.mts <jobId> [top5|best]
 *
 * Runs the same `buildCompareDrivers` the Done step uses over the job's saved session and its
 * track's line set, and prints who has sectors, from where, and the matrix on the basis given.
 */
import { PrismaClient } from "@prisma/client";
import { parseManualVideoSession } from "@/lib/manualVideoAnalysis/types";
import { buildCompareDrivers, segmentDefs, segmentStats, storyCards, valueOn } from "@/lib/videoAnalysis/driverCompare";

const prisma = new PrismaClient();
const jobId = process.argv[2]!;
const basis = (process.argv[3] as "top5" | "best") ?? "top5";
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({
  where: { id: jobId },
  include: { profile: { include: { sectorLines: { orderBy: { sortOrder: "asc" } } } } },
});
const session = parseManualVideoSession(job.manualJson);
if (!session) throw new Error("no manual session");
const lines = (job.profile?.sectorLines ?? []).map((l) => ({ lineKey: l.lineKey, label: l.label, sortOrder: l.sortOrder }));
const drivers = buildCompareDrivers(session, lines);
const segs = segmentDefs(lines);
console.log(`${job.id} · ${session.localVideoName} · ${lines.length} lines · scan ${session.lastScan?.at ?? "none"} · ${session.marks.length} marks`);
for (const d of drivers) {
  console.log(`  ${d.name.padEnd(20)} ${d.trust.padEnd(9)} ${d.laps.length} laps · splits/lap ${(d.laps.reduce((s, l) => s + Object.keys(l.splits).length, 0) / Math.max(1, d.laps.length)).toFixed(1)}`);
}
console.log(`\n${basis} matrix:`);
console.log(`  ${"sector".padEnd(10)}${drivers.map((d) => d.name.slice(0, 12).padStart(14)).join("")}`);
for (const s of segs) {
  console.log(
    `  ${`${s.name} ${s.fromLabel}→${s.toLabel}`.padEnd(10).slice(0, 10)}${drivers
      .map((d) => {
        const st = segmentStats(d, s);
        const v = valueOn(st, basis);
        return `${v == null ? "—" : v.toFixed(3)} (${st.clean.length}/${st.times.length})`.padStart(14);
      })
      .join("")}`
  );
}
const me = drivers.find((d) => d.role === "me");
if (me) {
  console.log("\nstory:");
  for (const c of storyCards(me, drivers.filter((d) => d !== me), segs, basis).slice(0, 8)) console.log(`  ${c.deltaSec >= 0 ? "+" : ""}${c.deltaSec.toFixed(3)}  ${c.sentence}`);
}
await prisma.$disconnect();
