// Every saved mark, per driver|line|lap: offset from the walked lap start, plus the
// "free accuracy check": gap between consecutive laps on the same line vs transponder lap time.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson ?? {};
const lapStart = new Map(); // role -> Map(lap -> videoTime) via walk from anchor
const lapTime = new Map();
const names = {};
for (const ts of m.timingSessions ?? []) {
  for (const d of ts.drivers ?? []) {
    names[d.role] = d.driverName;
    const a = ts.sync?.anchorByRole?.[d.role] ?? ts.sync?.anchor;
    if (!a || a.driverRole !== d.role) { console.log("no anchor for", d.role); continue; }
    const lt = new Map(d.laps.map(l => [l.lapNumber, l.lapTimeSec]));
    lapTime.set(d.role, lt);
    const starts = new Map();
    // sf_start on lap N => start of lap N at videoTimeSec
    let t = a.videoTimeSec;
    starts.set(a.lapNumber, t);
    for (let n = a.lapNumber + 1; n <= Math.max(...lt.keys()); n++) { t += lt.get(n - 1); starts.set(n, t); }
    t = a.videoTimeSec;
    for (let n = a.lapNumber - 1; n >= 1; n--) { t -= lt.get(n); starts.set(n, t); }
    lapStart.set(d.role, starts);
  }
}
console.log("selectedLaps", JSON.stringify(m.selectedLaps), "localVideoName", m.localVideoName, "timingUrls", JSON.stringify(m.timingUrls));
const marks = m.marks ?? [];
const lines = [...new Set(marks.map(x => x.lineKey))].sort();
const roles = ["r3", "competitor", "me", "r4"];
for (const role of roles) {
  console.log(`\n===== ${role} ${names[role]} =====`);
  const starts = lapStart.get(role); const lt = lapTime.get(role);
  const laps = [...new Set(marks.filter(x => x.driverRole === role).map(x => x.lapNumber))].sort((a, b) => a - b);
  console.log("lap   lapT   " + lines.map(l => l.padStart(14)).join(""));
  for (const lap of laps) {
    const cells = lines.map(l => {
      const mk = marks.find(x => x.driverRole === role && x.lapNumber === lap && x.lineKey === l);
      if (!mk) return "      --      ";
      const off = mk.videoTimeSec - starts.get(lap);
      const src = (mk.source ?? "hand").slice(0, 1) + (mk.suspect ? "!" : " ");
      return `${off.toFixed(2).padStart(7)} ${src}${String(mk.candidates?.length ?? 0).padStart(2)}  `;
    });
    console.log(`L${String(lap).padStart(2)} ${lt.get(lap).toFixed(2).padStart(6)} ` + cells.join(""));
  }
  // free accuracy check: consecutive-lap gap vs lap time
  console.log("consecutive-lap gap error (ms) = (t[lap+1]-t[lap]) - lapTime[lap]:");
  for (const l of lines) {
    const errs = [];
    for (const lap of laps) {
      const a = marks.find(x => x.driverRole === role && x.lapNumber === lap && x.lineKey === l);
      const b = marks.find(x => x.driverRole === role && x.lapNumber === lap + 1 && x.lineKey === l);
      if (a && b) errs.push(`L${lap}→${lap + 1}:${Math.round(((b.videoTimeSec - a.videoTimeSec) - lt.get(lap)) * 1000)}`);
    }
    if (errs.length) console.log(`  ${l}: ${errs.join("  ")}`);
  }
}
await prisma.$disconnect();
