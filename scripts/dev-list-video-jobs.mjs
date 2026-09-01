/** Dev only: the last few video-analysis jobs on the connected database, with their sync anchors. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const jobs = await prisma.videoAnalysisJob.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, createdAt: true, manualJson: true } });
for (const j of jobs) {
  const m = j.manualJson ?? {};
  const ts = m.timingSessions ?? m.sessions ?? [];
  const summary = Array.isArray(ts) ? ts.map((s) => `${s.sessionId}: anchor=${JSON.stringify(s.sync?.anchor)} byRole=${JSON.stringify(s.sync?.anchorByRole)} drivers=${s.drivers?.length}`).join(" | ") : "keys=" + Object.keys(m).join(",");
  console.log(j.id, j.createdAt.toISOString(), "marks=" + (m.marks?.length ?? "-"), summary);
}
await prisma.$disconnect();
