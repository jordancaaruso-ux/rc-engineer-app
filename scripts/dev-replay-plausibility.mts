/**
 * Replay the plausibility check over a job's saved crossings, then re-grade what survives.
 *
 * Nothing is re-detected. The question is only: of the crossings the scan wrote, which would the
 * current rule hold back — and does what remains agree with the transponder better than the lot.
 */
import { PrismaClient } from "@prisma/client";
import { flagImplausible, type RefinableResult } from "@/lib/videoAnalysis/findCrossings/refine";

const prisma = new PrismaClient();
const jobId = process.argv[2]!;
type Mark = { driverRole: string; lapNumber: number; lineKey: string; videoTimeSec: number };
type Lap = { lapNumber: number; lapTimeSec: number };

const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const m = job.manualJson as Record<string, unknown>;
// A saved scan (2026-08-28+) holds the held-back rows too, which is where this rule matters most;
// without one, only what was written can be judged.
const lastScan = m.lastScan as { rows: Array<Mark & { videoTimeSec: number | null; suspect: boolean }> } | undefined;
const marks: Mark[] = lastScan
  ? lastScan.rows.filter((r): r is Mark & { suspect: boolean } => r.videoTimeSec != null)
  : ((m.marks as Mark[]) ?? []);
if (lastScan) console.log(`replaying the saved scan (${marks.length} rows with a time, ${lastScan.rows.filter((r) => r.suspect).length} of them held back)`);
const sessions = (m.timingSessions as Array<{ isOnVideo: boolean; sync: { anchor: { videoTimeSec: number } }; drivers: Array<{ role: string; driverName: string; laps: Lap[] }> }>) ?? [];
const primary = sessions.find((s) => s.isOnVideo) ?? sessions[0]!;
const anchor = primary.sync.anchor;

const SF = "sf";
const results: RefinableResult[] = [];
const lapTimeOf = new Map<string, number>();
for (const d of primary.drivers) {
  if (d.role !== "me" && d.role !== "competitor") continue;
  let t = anchor.videoTimeSec;
  for (const lap of [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber)) {
    results.push({ id: `${d.role}:${lap.lapNumber}:${SF}`, lineKey: SF, lapNumber: lap.lapNumber, centerSec: t, detectedSec: t, quality: null, candidates: [], source: "confirmed" });
    lapTimeOf.set(`${d.role}:${lap.lapNumber}`, lap.lapTimeSec);
    t += lap.lapTimeSec;
  }
}
for (const mk of marks) {
  results.push({ id: `${mk.driverRole}:${mk.lapNumber}:${mk.lineKey}`, lineKey: mk.lineKey, lapNumber: mk.lapNumber, centerSec: mk.videoTimeSec, detectedSec: mk.videoTimeSec, quality: null, candidates: [], source: "unconfirmed" });
}
const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");
const flagged = flagImplausible(results, SF, lapKey);

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

function grade(label: string, keep: (id: string) => boolean) {
  console.log(`\n── ${label} ──`);
  for (const role of ["me", "competitor"]) {
    const rows = marks.filter((x) => x.driverRole === role && keep(`${role}:${x.lapNumber}:${x.lineKey}`));
    if (!rows.length) continue;
    const name = primary.drivers.find((d) => d.role === role)?.driverName;
    const out: string[] = [];
    for (const key of [...new Set(rows.map((r) => r.lineKey))].sort()) {
      const at = new Map(rows.filter((r) => r.lineKey === key).map((r) => [r.lapNumber, r.videoTimeSec]));
      const errs: number[] = [];
      for (const [lapNo, t] of at) {
        const next = at.get(lapNo + 1);
        const lt = lapTimeOf.get(`${role}:${lapNo + 1}`);
        if (next == null || lt == null) continue;
        errs.push(Math.abs(next - t - lt) * 1000);
      }
      out.push(`${key} n=${at.size} pairs=${errs.length} med=${errs.length ? med(errs).toFixed(0) : "—"}ms worst=${errs.length ? Math.max(...errs).toFixed(0) : "—"}ms`);
    }
    console.log(`  ${name}: ${out.join(" · ")}`);
  }
}

console.log(`${marks.length} saved crossings; the current rule would hold back ${[...flagged].filter((id) => !id.endsWith(":sf")).length}:`);
for (const id of [...flagged].filter((id) => !id.endsWith(":sf")).sort()) console.log(`   ${id}`);
grade("as saved", () => true);
grade("after holding those back", (id) => !flagged.has(id));
await prisma.$disconnect();
