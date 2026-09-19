import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const jobs = await prisma.videoAnalysisJob.findMany({
  orderBy: { createdAt: "desc" },
  take: 8,
  select: { id: true, createdAt: true, updatedAt: true, status: true, analysisMode: true, userId: true, manualJson: true, videoAsset: { select: { fileName: true, originalName: true, durationSec: true, width: true, height: true } } , track: { select: { name: true } } },
});
for (const j of jobs) {
  const mj = (j.manualJson && typeof j.manualJson === "object") ? j.manualJson : {};
  const keys = Object.keys(mj);
  const ls = mj.lastScan ? `lastScan(${(mj.lastScan.rows ?? mj.lastScan.results ?? []).length} rows)` : "no lastScan";
  console.log(j.id, j.createdAt.toISOString(), "upd", j.updatedAt.toISOString(), j.status, j.analysisMode, j.track?.name, JSON.stringify(j.videoAsset), ls, "keys:", keys.join(","));
}
await prisma.$disconnect();
