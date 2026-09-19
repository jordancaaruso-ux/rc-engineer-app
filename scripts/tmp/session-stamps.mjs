import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
const m = job.manualJson ?? {};
const VIDEO_START = Date.parse("2026-08-30T05:37:36Z"); // the file's creation_time (recording start)
for (const ts of m.timingSessions ?? []) {
  const d = ts.drivers?.[0];
  const a = ts.sync?.anchorByRole?.[d.role];
  const iso = ts.sessionCompletedAtIso ?? null;
  const predicted = iso ? (Date.parse(iso) - VIDEO_START) / 1000 : null;
  console.log(`${d.role.padEnd(11)} ${d.driverName.padEnd(16)} stamp=${iso}  predicted anchor=${predicted?.toFixed(1)}  tapped=${a?.videoTimeSec.toFixed(2)}  diff=${predicted != null ? (a.videoTimeSec - predicted).toFixed(2) : "-"}`);
}
await prisma.$disconnect();
