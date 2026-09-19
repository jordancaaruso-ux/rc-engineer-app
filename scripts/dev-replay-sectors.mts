/**
 * Replay a job's SAVED scan through the current review and print what each sector comes out at.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-replay-sectors.mts <jobId> [--walked]
 *
 * Nothing is re-detected: the crossings are the ones the scan already found. What changes is
 * everything decided AFTER detection — which lap start each crossing is measured against, and
 * which rows are held back as odd. `--walked` reverts to the transponder's accumulated lap
 * starts, so the same footage can be scored both ways.
 *
 * The number to read is the spread of each sector across the session. Real driving does not vary
 * by half a second in one corner and by five hundredths in the next.
 */
import { PrismaClient } from "@prisma/client";
import { reviewResults, type SessionTarget } from "@/lib/videoAnalysis/findCrossings/fromSession";
import type { RefinableResult } from "@/lib/videoAnalysis/findCrossings/refine";

const prisma = new PrismaClient();
const SF = "sf";
const walkedOnly = process.argv.includes("--walked");

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};

const jobId = process.argv[2]!;
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const manual = (job.manualJson ?? {}) as any;
const profile = await prisma.trackCameraProfile.findUniqueOrThrow({
  where: { id: job.profileId! },
  select: { name: true, sectorLines: true },
});
const lines = profile.sectorLines
  .filter((l: any) => l.x1 != null)
  .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
const corners = lines.filter((l: any) => l.lineKey !== SF);

const ts = (manual.timingSessions ?? []).find((s: any) => s.isOnVideo) ?? (manual.timingSessions ?? [])[0];
const driver = (ts.drivers ?? []).find((d: any) => d.role === "me") ?? ts.drivers[0];
const anchor = ts.sync?.anchorByRole?.me ?? ts.sync?.anchor;
const allLaps = [...driver.laps].sort((a: any, b: any) => a.lapNumber - b.lapNumber);

// The walk, exactly as the app builds it: one anchor plus every lap time added up.
const walk = new Map<number, number>();
const i0 = allLaps.findIndex((l: any) => l.lapNumber === anchor.lapNumber);
let t = anchor.videoTimeSec - (anchor.anchorKind === "sf_finish" ? allLaps[i0].lapTimeSec : 0);
walk.set(allLaps[i0].lapNumber, t);
for (let i = i0 + 1; i < allLaps.length; i++) { t += allLaps[i - 1].lapTimeSec; walk.set(allLaps[i].lapNumber, t); }
t = walk.get(allLaps[i0].lapNumber)!;
for (let i = i0 - 1; i >= 0; i--) { t -= allLaps[i].lapTimeSec; walk.set(allLaps[i].lapNumber, t); }

const rows = (manual.lastScan?.rows ?? []).filter((r: any) => (r.driverRole ?? "me") === "me");
const lapNumbers = [...new Set(rows.map((r: any) => r.lapNumber))].sort((a: any, b: any) => a - b) as number[];
const laps = lapNumbers
  .map((n) => ({ role: "me" as const, lapNumber: n, lapTimeSec: allLaps.find((l: any) => l.lapNumber === n)?.lapTimeSec ?? 0 }))
  .filter((l) => l.lapTimeSec > 0 && walk.get(l.lapNumber) != null);

const results: Array<RefinableResult & { role: "me" }> = rows.map((r: any) => ({
  id: `me:${r.lapNumber}:${r.lineKey}`,
  role: "me" as const,
  lineKey: r.lineKey,
  lapNumber: r.lapNumber,
  centerSec: r.videoTimeSec ?? walk.get(r.lapNumber) ?? 0,
  detectedSec: r.videoTimeSec,
  quality: null,
  candidates: (r.candidates ?? []).map((c: any) => ({ t: c.t, quality: c.quality, x: c.x, y: c.y, dir: c.dir })),
  source: r.source,
}));

const targets: SessionTarget[] = rows.map((r: any) => ({
  id: `me:${r.lapNumber}:${r.lineKey}`,
  role: "me" as const,
  lineKey: r.lineKey,
  lapNumber: r.lapNumber,
  centerSec: r.videoTimeSec ?? walk.get(r.lapNumber) ?? 0,
  truthSec: null,
}));

const review = reviewResults({
  results,
  targets,
  marks: [],
  lapStarts: laps.map((l) => ({ role: l.role, lapNumber: l.lapNumber, videoTimeSec: walk.get(l.lapNumber)! })),
  laps,
});

const startOf = new Map<number, number>();
for (const l of review.measuredLapStarts) {
  startOf.set(l.lapNumber, walkedOnly ? walk.get(l.lapNumber)! : l.videoTimeSec);
}

const at = new Map<number, Map<string, number>>();
// Held rows are shown too: whether they SHOULD be held is half of what changed.
for (const r of [...review.found, ...review.suspect]) {
  const m = at.get(r.lapNumber) ?? new Map<string, number>();
  m.set(r.lineKey, r.videoTimeSec);
  at.set(r.lapNumber, m);
}
const heldIds = new Set(review.suspect.map((r) => r.id));

console.log(`${jobId} · ${profile.name} · lap starts ${walkedOnly ? "WALKED (old)" : "MEASURED (new)"}`);
console.log("\nlap  lapTime " + corners.map((l: any) => l.label.padStart(8)).join("") + "    →finish  held");
const perSector = new Map<string, number[]>();
const home: number[] = [];
for (const lap of laps) {
  const start = startOf.get(lap.lapNumber);
  const found = at.get(lap.lapNumber);
  if (start == null || !found) continue;
  let prev = start;
  const cells: string[] = [];
  for (const line of corners) {
    const tt = found.get(line.lineKey);
    if (tt == null) { cells.push("       -"); continue; }
    const d = tt - prev;
    perSector.set(line.lineKey, [...(perSector.get(line.lineKey) ?? []), d]);
    cells.push(d.toFixed(3).padStart(8));
    prev = tt;
  }
  const end = startOf.get(lap.lapNumber + 1) ?? start + lap.lapTimeSec;
  if (prev !== start) home.push(end - prev);
  const held = [...found.keys()].filter((k) => heldIds.has(`me:${lap.lapNumber}:${k}`)).length;
  console.log(
    String(lap.lapNumber).padStart(3) + "  " + lap.lapTimeSec.toFixed(3).padStart(7) +
    cells.join("") + "  " + (end - prev).toFixed(3).padStart(8) + "  " + held
  );
}

console.log("\nsector spread across the session:");
for (const line of corners) {
  const xs = (perSector.get(line.lineKey) ?? []).sort((a, b) => a - b);
  if (!xs.length) continue;
  console.log(
    `  ${line.label.padEnd(4)} n=${String(xs.length).padStart(2)}  median ${med(xs).toFixed(3)}s  ` +
      `min ${xs[0]!.toFixed(3)}  max ${xs[xs.length - 1]!.toFixed(3)}  spread ${(xs[xs.length - 1]! - xs[0]!).toFixed(3)}s`
  );
}
if (home.length) {
  const xs = home.sort((a, b) => a - b);
  console.log(`  home n=${xs.length}  median ${med(xs).toFixed(3)}s  spread ${(xs[xs.length - 1]! - xs[0]!).toFixed(3)}s`);
}
console.log(`\nwritten ${review.found.length} · held ${review.suspect.length} · missing ${review.missing.length}`);
for (const l of review.measuredLapStarts) {
  if (Math.abs(l.driftSec) > 0.01) {
    console.log(`  L${String(l.lapNumber).padStart(2)} lap start moved ${l.driftSec >= 0 ? "+" : ""}${l.driftSec.toFixed(3)}s${l.detected ? " (detected)" : ""}`);
  }
}
for (const d of review.clockDisagreements) {
  console.log(`  ${d.lapKey}: filmed ${d.filmedSec.toFixed(3)}s vs sheet ${d.timedSec.toFixed(3)}s (${(d.diffSec * 1000).toFixed(0)}ms, ${d.lines} lines)`);
}
await prisma.$disconnect();
