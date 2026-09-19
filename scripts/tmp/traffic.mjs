// Traffic density per window (distinct events after merging +/- pairs within 60ms), per driver,
// and a lap-shift test for Cooper: does a different lap numbering fit the candidates better?
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson ?? {};
const names = {}; const lapsOf = {}; const anchorOf = {};
for (const ts of m.timingSessions ?? []) for (const d of ts.drivers ?? []) { names[d.role] = d.driverName; lapsOf[d.role] = d.laps; anchorOf[d.role] = ts.sync?.anchorByRole?.[d.role] ?? ts.sync?.anchor; }
const rows = [...(m.marks ?? []), ...(m.lastScan?.rows ?? [])];
const distinct = (cands) => { const ts = [...cands].map(c => c.t).sort((a, b) => a - b); const out = []; for (const t of ts) if (!out.length || t - out[out.length - 1] > 0.06) out.push(t); return out; };
console.log("=== distinct events per window (rough traffic), by driver and line ===");
for (const role of ["r3", "competitor", "me", "r4"]) {
  const mine = rows.filter(r => r.driverRole === role && r.candidates?.length);
  const byLine = {};
  for (const r of mine) (byLine[r.lineKey] ??= []).push(distinct(r.candidates).length);
  const fmt = Object.entries(byLine).sort().map(([l, xs]) => `${l}: mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)} max ${Math.max(...xs)} (n=${xs.length})`).join(" | ");
  console.log(`${role.padEnd(11)} ${names[role].padEnd(16)} ${fmt}`);
}
// Windows with >= 6 distinct events, listed in time order (where is the noise?)
console.log("\n=== windows with >=6 distinct events (time order) ===");
const busy = rows.filter(r => r.candidates && distinct(r.candidates).length >= 6).map(r => ({ t: Math.min(...r.candidates.map(c => c.t)), to: Math.max(...r.candidates.map(c => c.t)), n: distinct(r.candidates).length, role: r.driverRole, lap: r.lapNumber, line: r.lineKey })).sort((a, b) => a.t - b.t);
for (const b of busy) console.log(`  ${b.t.toFixed(1).padStart(7)}–${b.to.toFixed(1).padStart(7)}  ${String(b.n).padStart(2)} events  ${b.role} L${b.lap} ${b.line}`);

// Lap-shift test for Cooper: assume the crossing tapped at the anchor was LiveRC lap (1+k).
console.log("\n=== Cooper lap-shift test: candidates within 0.2s of a consistent per-line offset ===");
const role = "r3"; const laps = lapsOf[role]; const a = anchorOf[role];
const lt = new Map(laps.map(l => [l.lapNumber, l.lapTimeSec]));
const candsByLine = {};
for (const r of rows.filter(r => r.driverRole === role)) for (const c of (r.candidates ?? [])) (candsByLine[r.lineKey] ??= []).push(c.t);
for (let k = 0; k <= 12; k++) {
  // video lap n (1-based from the anchor) = LiveRC lap n+k; start(n) = anchor + sum lt[k+1 .. n+k-1]
  const starts = []; let t = a.videoTimeSec; starts.push(t);
  for (let n = 2; n <= 20; n++) { const L = lt.get(n - 1 + k); if (L == null) break; t += L; starts.push(t); }
  let score = 0; const detail = [];
  for (const [line, ts] of Object.entries(candsByLine)) {
    const offs = [];
    for (const c of ts) { // assign to the lap whose interval holds it
      let i = starts.findIndex((s, j) => c >= s && (j + 1 >= starts.length || c < starts[j + 1]));
      if (i < 0) continue; offs.push({ off: c - starts[i], lap: i + 1 });
    }
    // largest cluster of offsets across DISTINCT laps within ±0.2s
    let best = 0, bestC = 0;
    for (const o of offs) { const lapsIn = new Set(offs.filter(p => Math.abs(p.off - o.off) <= 0.2).map(p => p.lap)); if (lapsIn.size > best) { best = lapsIn.size; bestC = o.off; } }
    score += best; detail.push(`${line}:${best}@${bestC.toFixed(2)}`);
  }
  console.log(`  shift k=${String(k).padStart(2)}  laps-agreeing total=${String(score).padStart(2)}  ${detail.join("  ")}`);
}
await prisma.$disconnect();
