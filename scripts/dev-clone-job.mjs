/** Dev only: copy a VideoAnalysisJob so a test can be driven without touching the real one. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const src = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: process.argv[2] } });
if (process.argv[3] === "--delete") {
  await prisma.videoAnalysisJob.delete({ where: { id: process.argv[2] } });
  console.log("deleted " + process.argv[2]);
} else {
  const { id, createdAt, updatedAt, ...rest } = src;
  // --clear-marks: start from the session's timing + sync alone, so a scan is graded on what it
  // found, not on what was already there.
  if (process.argv.includes("--clear-marks")) {
    rest.manualJson = { ...rest.manualJson, marks: [] };
  }
  // --first-crossing: an anchor set as "L1 start" by the old Sync step is in fact the car's first
  // time over the loop — the END of lap 1 in a race. Re-label it so the walk lands every lap
  // start where the transponder says (the 2026-08-27 anchor finding: 1.386s late before this).
  if (process.argv.includes("--first-crossing")) {
    const sessions = rest.manualJson?.timingSessions ?? [];
    for (const ts of sessions) {
      if (!ts.sync?.anchor) continue;
      const a = { ...ts.sync.anchor, lapNumber: 1, anchorKind: "sf_finish" };
      ts.sync = { ...ts.sync, anchor: a, anchorByRole: { ...(ts.sync.anchorByRole ?? {}), me: a } };
    }
  }
  // --profile <id>: read another line set (a camera profile on the same track) on the copy.
  const pi = process.argv.indexOf("--profile");
  if (pi > 0 && process.argv[pi + 1]) rest.profileId = process.argv[pi + 1];
  const copy = await prisma.videoAnalysisJob.create({ data: { ...rest } });
  console.log(copy.id);
}
await prisma.$disconnect();
