import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] }, include: { profile: { include: { sectorLines: true } } } });
const m = job.manualJson;
const s = m.timingSessions.find((x) => x.isOnVideo) ?? m.timingSessions[0];
console.log(JSON.stringify({
  anchor: s.sync.anchor,
  lines: job.profile.sectorLines.sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ key: l.lineKey, label: l.label, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 })),
  drivers: s.drivers.filter((d) => d.role === "me" || d.role === "competitor").map((d) => ({ role: d.role, name: d.driverName, laps: d.laps.map((l) => l.lapTimeSec) })),
}, null, 1));
await prisma.$disconnect();
