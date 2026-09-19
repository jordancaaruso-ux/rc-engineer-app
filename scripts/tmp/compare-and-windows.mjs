import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson ?? {};
console.log("compare:", JSON.stringify(m.compare).slice(0, 1500));
const rows = [...(m.marks ?? []), ...(m.lastScan?.rows ?? [])];
const distinct = (cands) => { const ts = [...cands].map(c => c.t).sort((a, b) => a - b); const out = []; for (const t of ts) if (!out.length || t - out[out.length - 1] > 0.06) out.push(t); return out; };
console.log("\n=== share of windows with more than one distinct event, per driver ===");
for (const role of ["r3", "competitor", "me", "r4"]) {
  const mine = rows.filter(r => r.driverRole === role && r.candidates);
  const multi = mine.filter(r => distinct(r.candidates).length > 1).length;
  const empty = mine.filter(r => distinct(r.candidates).length === 0).length;
  console.log(`${role.padEnd(11)} windows=${mine.length} multi-event=${multi} (${Math.round(100 * multi / mine.length)}%) empty=${empty}`);
}
// Pairs: how often a +1 and -1 sit within 60ms (same blob flickering both ways)
console.log("\n=== +/- pairs within 60ms (one blob read both ways), per driver ===");
for (const role of ["r3", "competitor", "me", "r4"]) {
  let pairs = 0, cands = 0;
  for (const r of rows.filter(r => r.driverRole === role && r.candidates)) {
    const cs = [...r.candidates].sort((a, b) => a.t - b.t); cands += cs.length;
    for (let i = 1; i < cs.length; i++) if (cs[i].t - cs[i - 1].t <= 0.06 && cs[i].dir && cs[i - 1].dir && cs[i].dir !== cs[i - 1].dir) pairs++;
  }
  console.log(`${role.padEnd(11)} candidates=${cands} flip-pairs=${pairs}`);
}
await prisma.$disconnect();
