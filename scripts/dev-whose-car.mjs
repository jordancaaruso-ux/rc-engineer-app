/**
 * Dev only: for every saved crossing, which driver in the field was actually due at that line at
 * that moment?
 *
 * Each driver's lap starts are walked from the shared race anchor with their own transponder lap
 * times, and each line's typical offset-from-lap-start is taken from the driver the crossing was
 * saved under. A crossing that sits near ANOTHER driver's expected time, and far from its own, was
 * that other driver's car. This turns "the error is lap-wide" into a name.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson;
const session = (m.timingSessions ?? []).find((s) => s.isOnVideo) ?? m.timingSessions[0];
const anchor = session.sync.anchor;
const marks = m.marks ?? [];

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// Lap starts for everyone, from the one race anchor.
const startsOf = new Map();
for (const d of session.drivers) {
  let t = anchor.videoTimeSec;
  const starts = new Map();
  for (const lap of [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber)) { starts.set(lap.lapNumber, t); t += lap.lapTimeSec; }
  startsOf.set(d.driverName, { role: d.role, starts });
}

for (const role of ["me", "competitor"]) {
  const driver = session.drivers.find((d) => d.role === role);
  if (!driver) continue;
  const rows = marks.filter((x) => x.driverRole === role);
  if (!rows.length) continue;
  const own = startsOf.get(driver.driverName).starts;
  console.log("=".repeat(76));
  console.log(`${role.toUpperCase()} — ${driver.driverName} — ${rows.length} saved crossings`);
  const lines = [...new Set(rows.map((r) => r.lineKey))].sort();
  const counts = lines.map((k) => `${k}:${rows.filter((r) => r.lineKey === k).length}`).join("  ");
  console.log(`  per line: ${counts}`);

  for (const key of lines) {
    const mine = rows.filter((r) => r.lineKey === key);
    // Typical offset for this line, from the crossings that agree with each other.
    const offs = mine.map((r) => r.videoTimeSec - (own.get(r.lapNumber) ?? NaN)).filter(Number.isFinite);
    const typical = med(offs);
    console.log(`  ${key}  typical offset ${typical.toFixed(2)}s`);
    for (const r of [...mine].sort((a, b) => a.lapNumber - b.lapNumber)) {
      const ownErr = r.videoTimeSec - (own.get(r.lapNumber) + typical);
      if (Math.abs(ownErr) < 0.3) continue; // fine — skip the good ones
      // Who else was due here?
      let best = null;
      for (const [name, info] of startsOf) {
        for (const [lapNo, s] of info.starts) {
          const e = r.videoTimeSec - (s + typical);
          if (best == null || Math.abs(e) < Math.abs(best.e)) best = { name, lapNo, e };
        }
      }
      const who = best && Math.abs(best.e) < 0.35 && best.name !== driver.driverName ? `${best.name} L${best.lapNo} (${(best.e * 1000).toFixed(0)}ms)` : best && best.name === driver.driverName ? `own L${best.lapNo}?? (${(best.e * 1000).toFixed(0)}ms)` : "nobody near";
      console.log(`     L${String(r.lapNumber).padEnd(2)} off by ${(ownErr * 1000).toFixed(0).padStart(6)}ms  →  ${who}`);
    }
  }
}
await prisma.$disconnect();
