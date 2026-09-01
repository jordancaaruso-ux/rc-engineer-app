/**
 * Dev only: what a job's SAVED scan (`manualJson.lastScan`) said, line by line — how many rows were
 * ready, held back (and why: another car / odd / unconfirmed), or not found — plus the picker's
 * saved verdicts (`lastIdentify`). Read this before diagnosing "why were so many held back".
 *
 *   npx dotenv -e .env.local -- node scripts/dev-dump-scan.mjs <jobId>
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const jobId = process.argv[2];
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const m = job.manualJson ?? {};
const scan = m.lastScan;
if (!scan) { console.log("no lastScan on this job; keys=" + Object.keys(m).join(",")); process.exit(0); }
console.log(`scan at ${scan.at}  rows=${scan.rows.length}  marks=${(m.marks ?? []).length}`);
const ts = (m.timingSessions ?? []).find((s) => s.isOnVideo) ?? (m.timingSessions ?? [])[0];
if (ts) {
  console.log("anchor", JSON.stringify(ts.sync?.anchor), "byRole", JSON.stringify(ts.sync?.anchorByRole));
  for (const d of ts.drivers ?? []) console.log(`  driver ${d.role.padEnd(10)} ${d.driverName.padEnd(16)} laps=${d.laps.length} avg=${(d.laps.reduce((a, l) => a + l.lapTimeSec, 0) / d.laps.length).toFixed(2)}`);
}
const by = new Map();
for (const r of scan.rows) {
  const k = `${r.driverRole}|${r.lineKey}`;
  const e = by.get(k) ?? { ready: 0, otherCar: 0, ownLap: 0, odd: 0, unconfirmed: 0, missing: 0, laps: [] };
  if (r.videoTimeSec == null) e.missing++;
  else if (!r.suspect) e.ready++;
  else if (r.claimedBy && r.claimedBy.key !== r.driverRole) e.otherCar++;
  else if (r.claimedBy) e.ownLap++;
  else if (r.source === "unconfirmed") e.unconfirmed++;
  else e.odd++;
  e.laps.push(r);
  by.set(k, e);
}
for (const [k, e] of [...by].sort()) {
  console.log(`\n${k.padEnd(16)} ready=${e.ready} otherCar=${e.otherCar} ownLap=${e.ownLap} odd=${e.odd} unconfirmed=${e.unconfirmed} missing=${e.missing}`);
  for (const r of e.laps.sort((a, b) => a.lapNumber - b.lapNumber)) {
    const tag = r.videoTimeSec == null ? "MISSING" : !r.suspect ? "ready" : r.claimedBy ? `HELD claimed by ${r.claimedBy.by} L${r.claimedBy.lapNumber}` : r.source === "unconfirmed" ? "HELD unconfirmed" : "HELD odd";
    const cands = (r.candidates ?? []).map((c) => c.t.toFixed(2) + (c.dir ? c.dir : "")).join(" ");
    console.log(`   L${String(r.lapNumber).padStart(2)} t=${r.videoTimeSec == null ? "   -   " : r.videoTimeSec.toFixed(2).padStart(7)} ${r.source ?? "-"}  ${tag}   cands[${(r.candidates ?? []).length}]: ${cands}`);
  }
}
if (m.lastIdentify) {
  const li = m.lastIdentify;
  console.log(`\nlastIdentify role=${li.driverRole} auto=${JSON.stringify(li.auto ?? null)}`);
  for (const [line, v] of Object.entries(li.lines ?? li.byLine ?? {})) console.log(`  ${line}: ${JSON.stringify(v).slice(0, 400)}`);
  const rest = Object.keys(li).filter((k) => !["driverRole", "auto", "lines", "byLine"].includes(k));
  if (rest.length) console.log("  other keys:", rest.join(","), JSON.stringify(Object.fromEntries(rest.map((k) => [k, li[k]]))).slice(0, 1500));
}
await prisma.$disconnect();
