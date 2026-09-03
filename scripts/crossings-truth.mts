/**
 * Freeze a job's HAND marks as ground truth, before a scan can mix its own answers in with them.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/crossings-truth.mts <jobId> [--label NAME]
 *
 * Marks a driver places by hand carry no `source`; every row a scan writes does. That is the only
 * thing separating truth from the detector's own output, it lives in one array, and it does not
 * survive a timing reload. So the moment marks exist, they are copied out to `data/crossing-truth`
 * — with the lines, the lap times and the video's name — where nothing in the app can touch them.
 *
 * This is what a change gets graded against. Without it every "improvement" is the detector
 * marking its own homework (see `synthetic.ts` for why that matters).
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const jobId = process.argv[2];
if (!jobId) throw new Error("usage: crossings-truth.mts <jobId> [--label NAME]");
const labelArg = process.argv.indexOf("--label");
const label = labelArg > 0 ? process.argv[labelArg + 1]! : null;

const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const manual = (job.manualJson ?? {}) as any;
const profile = job.profileId
  ? await prisma.trackCameraProfile.findUnique({
      where: { id: job.profileId },
      select: { name: true, sectorLines: true },
    })
  : null;

const hand = (manual.marks ?? []).filter((m: any) => !m.source);
if (hand.length === 0) throw new Error("no hand marks on this job — nothing to freeze");
const ts = (manual.timingSessions ?? []).find((s: any) => s.isOnVideo) ?? (manual.timingSessions ?? [])[0];
const driver = (ts?.drivers ?? []).find((d: any) => d.role === "me") ?? ts?.drivers?.[0];

const laps = [...new Set(hand.map((m: any) => m.lapNumber))].sort((a: any, b: any) => a - b);
const out = {
  jobId,
  frozenAt: new Date().toISOString(),
  label: label ?? profile?.name ?? jobId,
  video: manual.localVideoName ?? null,
  profile: profile?.name ?? null,
  lines: (profile?.sectorLines ?? []).map((l: any) => ({
    lineKey: l.lineKey, label: l.label, sortOrder: l.sortOrder,
    x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
  })),
  // The anchor and lap times are part of the truth: a mark is a video time, and reading it back
  // needs the same lap numbering it was made under.
  sync: ts?.sync ?? null,
  laps: (driver?.laps ?? []).map((l: any) => ({ lapNumber: l.lapNumber, lapTimeSec: l.lapTimeSec })),
  markedLaps: laps,
  marks: hand.map((m: any) => ({
    driverRole: m.driverRole ?? "me",
    lapNumber: m.lapNumber,
    lineKey: m.lineKey,
    videoTimeSec: m.videoTimeSec,
  })),
};

const file = `data/crossing-truth/${jobId}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`froze ${hand.length} hand marks on laps ${laps.join(", ")} → ${file}`);
console.log(`video: ${out.video ?? "(unknown)"} · lines: ${out.lines.length} · profile: ${out.profile}`);
await prisma.$disconnect();
