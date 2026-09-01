/** Dev only: every line set (camera profile) on a job's track, with its lines and when they were saved. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] }, select: { profileId: true, profile: { select: { trackId: true } } } });
const profiles = await prisma.trackCameraProfile.findMany({ where: { trackId: job.profile.trackId }, include: { sectorLines: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "asc" } });
for (const p of profiles) {
  console.log(`${p.id === job.profileId ? "*" : " "} ${p.name} (${p.id}) created ${p.createdAt.toISOString()}`);
  for (const l of p.sectorLines) console.log(`    ${l.lineKey.padEnd(4)} (${l.x1.toFixed(4)},${l.y1.toFixed(4)})→(${l.x2.toFixed(4)},${l.y2.toFixed(4)}) saved ${l.createdAt.toISOString()}`);
}
await prisma.$disconnect();
