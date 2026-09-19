// For every held or missing row: was there a candidate (any direction) within 0.3s of where this
// driver usually crosses this line? If so, which way did it read, vs the line's declared way?
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson ?? {};
const lapStart = new Map(); const names = {};
for (const ts of m.timingSessions ?? []) for (const d of ts.drivers ?? []) {
  names[d.role] = d.driverName;
  const a = ts.sync?.anchorByRole?.[d.role]; if (!a) continue;
  const lt = new Map(d.laps.map(l => [l.lapNumber, l.lapTimeSec]));
  const starts = new Map(); let t = a.videoTimeSec; starts.set(a.lapNumber, t);
  for (let n = a.lapNumber + 1; n <= Math.max(...lt.keys()); n++) { t += lt.get(n - 1); starts.set(n, t); }
  lapStart.set(d.role, starts);
}
const marks = m.marks ?? [];
// declared direction per line = majority of mark dirs
const dirOf = {};
for (const line of ["s1", "s2", "s3", "s4", "s5", "s6"]) { const ds = marks.filter(x => x.lineKey === line && x.dir).map(x => x.dir); dirOf[line] = ds.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1; }
console.log("line directions from marks:", JSON.stringify(dirOf));
// typical offset per driver|line from marks
const typ = {};
for (const role of ["competitor", "me", "r4"]) for (const line of Object.keys(dirOf)) {
  const offs = marks.filter(x => x.driverRole === role && x.lineKey === line).map(x => x.videoTimeSec - lapStart.get(role).get(x.lapNumber)).sort((a, b) => a - b);
  if (offs.length) typ[`${role}|${line}`] = offs[Math.floor(offs.length / 2)];
}
console.log("typical offsets:", JSON.stringify(Object.fromEntries(Object.entries(typ).map(([k, v]) => [k, +v.toFixed(2)]))));
const rows = (m.lastScan?.rows ?? []).filter(r => r.driverRole !== "r3" && (r.suspect || r.videoTimeSec == null));
console.log("\nheld/missing rows (Justin, Jordan, Sandy) — nearest candidate to the driver's usual spot:");
for (const r of rows) {
  const exp = lapStart.get(r.driverRole).get(r.lapNumber) + typ[`${r.driverRole}|${r.lineKey}`];
  const near = (r.candidates ?? []).map(c => ({ ...c, d: c.t - exp })).filter(c => Math.abs(c.d) <= 0.35).sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const chosenOff = r.videoTimeSec == null ? null : (r.videoTimeSec - lapStart.get(r.driverRole).get(r.lapNumber));
  console.log(`  ${r.driverRole.padEnd(10)} L${String(r.lapNumber).padStart(2)} ${r.lineKey}  chosen=${r.videoTimeSec?.toFixed(2) ?? "  -   "} (off ${chosenOff?.toFixed(2) ?? "-"}, usual ${typ[`${r.driverRole}|${r.lineKey}`].toFixed(2)})  expected≈${exp.toFixed(2)}  near: ${near.length ? near.map(c => `${c.t.toFixed(2)} dir${c.dir > 0 ? "+" : "-"}${c.dir === dirOf[r.lineKey] ? "(right way)" : "(WRONG WAY→stripped)"} ${c.source ?? ""}`).join(", ") : "nothing within 0.35s"}`);
}
await prisma.$disconnect();
