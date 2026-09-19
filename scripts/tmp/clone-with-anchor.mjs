// Clone a job, clear marks/lastScan, and move one role's anchor to a new video time.
//   node scripts/tmp/clone-with-anchor.mjs <jobId> <role> <videoTimeSec>
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const [jobId, role, tArg] = process.argv.slice(2);
const src = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const { id, createdAt, updatedAt, ...rest } = src;
const mj = { ...rest.manualJson, marks: [], lastScan: undefined, lastIdentify: undefined };
for (const ts of mj.timingSessions ?? []) {
  const a = ts.sync?.anchorByRole?.[role];
  if (!a) continue;
  const moved = { ...a, videoTimeSec: Number(tArg) };
  ts.sync = { ...ts.sync, anchor: ts.sync.anchor?.driverRole === role ? moved : ts.sync.anchor, anchorByRole: { ...ts.sync.anchorByRole, [role]: moved }, perLapSfStart: undefined, perLapSfEnd: undefined };
}
rest.manualJson = mj;
const copy = await prisma.videoAnalysisJob.create({ data: { ...rest } });
console.log(copy.id);
await prisma.$disconnect();
