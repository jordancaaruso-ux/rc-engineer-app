/**
 * Grade saved crossings without re-scanning and without watching anything.
 *
 * A line is crossed once per lap, so the gap between one lap's crossing of a line and
 * the next lap's crossing of the SAME line must equal that lap's transponder time.
 * The transponder is independent of the video, so this is a real accuracy measure —
 * not a self-consistency check.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const jobId = process.argv[2];
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const m = job.manualJson;
const marks = m.marks ?? [];
const session = (m.timingSessions ?? []).find((s) => s.isOnVideo) ?? (m.timingSessions ?? [])[0];
// Which lap the gap between crossing n and crossing n+1 belongs to. Under the corrected Sync step
// (anchor = a crossing that ENDS a lap, kind sf_finish) mark lap n really is lap n, so the gap is
// lap n's time; under the old "L1 start" anchor every mark sat one lap late, hence the +1.
const lapShift = session?.sync?.anchor?.anchorKind === "sf_finish" ? 0 : 1;

const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

for (const role of ["me", "competitor"]) {
  const driver = session.drivers.find((d) => d.role === role);
  if (!driver) continue;
  const rows = marks.filter((x) => x.driverRole === role);
  if (!rows.length) continue;
  console.log("=".repeat(72));
  console.log(`${role.toUpperCase()} — ${driver.driverName}`);
  const lines = [...new Set(rows.map((r) => r.lineKey))].sort();
  console.log("line   pairs   median error   worst error   errors (ms)");
  for (const key of lines) {
    const at = new Map(rows.filter((r) => r.lineKey === key).map((r) => [r.lapNumber, r.videoTimeSec]));
    const errs = [];
    for (const [lapNo, t] of at) {
      const next = at.get(lapNo + 1);
      if (next == null) continue;
      const lap = driver.laps.find((l) => l.lapNumber === lapNo + lapShift);
      if (!lap?.lapTimeSec) continue;
      errs.push({ lap: lapNo + lapShift, err: (next - t) - lap.lapTimeSec });
    }
    if (!errs.length) { console.log(`${key.padEnd(6)}      0        —             —`); continue; }
    const abs = errs.map((e) => Math.abs(e.err));
    console.log(
      `${key.padEnd(6)} ${String(errs.length).padStart(5)}   ${(med(abs) * 1000).toFixed(0).padStart(8)} ms   ${(Math.max(...abs) * 1000).toFixed(0).padStart(8)} ms   ` +
      errs.map((e) => `L${e.lap}:${(e.err * 1000).toFixed(0)}`).join(" ")
    );
  }
}
await prisma.$disconnect();
