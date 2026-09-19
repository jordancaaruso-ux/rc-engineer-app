import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] }, include: { videoAsset: true, track: { select: { name: true } }, profile: { select: { id: true, name: true, sectorLines: true } } } });
console.log("status", job.status, "mode", job.analysisMode, "track", job.track?.name, "profile", job.profile?.id, job.profile?.name);
console.log("videoAsset", JSON.stringify(job.videoAsset, null, 1));
const m = job.manualJson ?? {};
console.log("manualJson keys", Object.keys(m));
console.log("version", m.version, "lineSetId", m.lineSetId ?? m.sectorLineSetId, "frameRate", m.frameRate ?? m.fps, "video", JSON.stringify(m.video ?? null));
for (const ts of m.timingSessions ?? []) {
  console.log(`\nsession ${ts.sessionId} isOnVideo=${ts.isOnVideo} source=${ts.source ?? ""} url=${ts.sourceUrl ?? ts.url ?? ""} label=${ts.label ?? ""}`);
  console.log("  sync", JSON.stringify(ts.sync));
  for (const d of ts.drivers ?? []) {
    const laps = d.laps ?? [];
    console.log(`  driver ${d.role} ${d.driverName} laps=${laps.length} selected=${JSON.stringify(ts.selectedLaps?.[d.role] ?? m.selectedLaps?.[d.role] ?? null)}`);
    console.log("   lapTimes: " + laps.map(l => `L${l.lapNumber}=${l.lapTimeSec.toFixed(3)}`).join(" "));
  }
}
console.log("\nlines:", JSON.stringify(m.lines ?? m.sectorLines ?? null)?.slice(0, 2000));
const lastScan = m.lastScan;
if (lastScan) { console.log("\nlastScan keys", Object.keys(lastScan), "at", lastScan.at, "rows", lastScan.rows.length, "extra:", JSON.stringify(Object.fromEntries(Object.entries(lastScan).filter(([k]) => !["rows"].includes(k)))).slice(0, 1500)); }
if (m.lastIdentify) console.log("\nlastIdentify", JSON.stringify(m.lastIdentify).slice(0, 3000));
const marks = m.marks ?? [];
console.log("\nmarks", marks.length, "sample", JSON.stringify(marks.slice(0, 3)));
const bySrc = {};
for (const mk of marks) { const k = `${mk.driverRole}|${mk.source ?? "hand"}`; bySrc[k] = (bySrc[k] ?? 0) + 1; }
console.log("marks by role|source", JSON.stringify(bySrc));
await prisma.$disconnect();
