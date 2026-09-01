/**
 * Replay the three arithmetic fixes over the crossings already saved on a job.
 *
 * Nothing is re-detected and nothing is written — this asks only "what would the new passes have
 * done to the answers we already have", which is the cheapest honest way to tell a fix from a
 * hope.
 */
import { PrismaClient } from "@prisma/client";
import { realLaps } from "@/lib/videoAnalysis/findCrossings/fromSession";
import { dropDuplicates, flagOutOfOrder, type RefinableResult } from "@/lib/videoAnalysis/findCrossings/refine";

const prisma = new PrismaClient();
const jobId = process.argv[2]!;

type Mark = { driverRole: string; lapNumber: number; lineKey: string; videoTimeSec: number };
type Lap = { lapNumber: number; lapTimeSec: number; isIncluded?: boolean };

const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const m = job.manualJson as Record<string, unknown>;
const marks = (m.marks as Mark[]) ?? [];
const sessions = (m.timingSessions as Array<{
  isOnVideo: boolean;
  sync: { anchor?: { videoTimeSec: number; lapNumber: number; driverRole: string } };
  drivers: Array<{ role: string; driverName: string; laps: Lap[] }>;
}>) ?? [];
const primary = sessions.find((s) => s.isOnVideo) ?? sessions[0]!;
const anchor = primary.sync.anchor!;

console.log("── 1. Which laps are real? ──────────────────────────────────────");
for (const d of primary.drivers) {
  if (d.role !== "me" && d.role !== "competitor") continue;
  const kept = new Set(realLaps(d.laps).map((l) => l.lapNumber));
  const dropped = d.laps.filter((l) => !kept.has(l.lapNumber));
  console.log(
    `  ${d.driverName}: ${kept.size}/${d.laps.length} kept` +
      (dropped.length ? ` — dropped ${dropped.map((l) => `L${l.lapNumber}(${l.lapTimeSec}s)`).join(", ")}` : " — none dropped")
  );
}

// Lap starts: everyone in a race leaves at the same instant, so the one anchor serves the field.
const SF = "sf";
const results: RefinableResult[] = [];
for (const d of primary.drivers) {
  if (d.role !== "me" && d.role !== "competitor") continue;
  let t = anchor.videoTimeSec;
  for (const lap of [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber)) {
    results.push({
      id: `${d.role}:${lap.lapNumber}:${SF}`,
      lineKey: SF, lapNumber: lap.lapNumber, centerSec: t, detectedSec: t, quality: null, candidates: [], source: "confirmed",
    });
    t += lap.lapTimeSec;
  }
}
for (const mk of marks) {
  results.push({
    id: `${mk.driverRole}:${mk.lapNumber}:${mk.lineKey}`,
    lineKey: mk.lineKey, lapNumber: mk.lapNumber,
    centerSec: mk.videoTimeSec, detectedSec: mk.videoTimeSec,
    quality: null, candidates: [], source: "unconfirmed",
  });
}
const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");
const roleOf = (id: string) => id.split(":")[0]!;

console.log("\n── 2. Duplicate crossings ───────────────────────────────────────");
const dups = dropDuplicates(results, (r) => `${roleOf(r.id)}:${r.lineKey}`, 1.0);
const realDups = [...dups].filter((id) => !id.endsWith(`:${SF}`));
console.log(`  ${realDups.length} crossing(s) would be dropped as one event counted twice:`);
for (const id of realDups.sort()) {
  const r = results.find((x) => x.id === id)!;
  console.log(`    ${id} at ${r.detectedSec!.toFixed(3)}s`);
}

console.log("\n── 3. Corners out of track order ────────────────────────────────");
const live = results.filter((r) => !dups.has(r.id));
const odd = flagOutOfOrder(live, SF, lapKey);
console.log(`  ${odd.size} crossing(s) would be held back as impossible:`);
for (const id of [...odd].sort()) {
  const r = results.find((x) => x.id === id)!;
  console.log(`    ${id} at ${r.detectedSec!.toFixed(3)}s`);
}
await prisma.$disconnect();
