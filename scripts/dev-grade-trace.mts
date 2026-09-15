/**
 * Dev only: grade a traced lap saved on a job, and its delta line against the sector board.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-grade-trace.mts <jobId>
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-grade-trace.mts <jobId> --role me --lap 7
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-grade-trace.mts <jobId> --role me --lap 7 --vs competitor:5
 *
 * No arguments beyond the job: every trace on it, one line each. With a lap: that trace sector
 * by sector — coverage, holes, how far the path sat from each stored crossing. With `--vs`: the
 * delta line between the two traces, read at every sector line against the board's own cumulative
 * delta for the same two laps. The board and the tracer measured the same instants independently,
 * so this table is the check that costs nothing.
 */
import { PrismaClient } from "@prisma/client";
import { parseManualVideoSession, traceKey, type DriverRole, type ManualLapTrace } from "@/lib/manualVideoAnalysis/types";
import { buildCompareDrivers, lapRows, segmentDefs, segmentStats } from "@/lib/videoAnalysis/driverCompare";
import { SF_LINE_KEY } from "@/lib/videoAnalysis/findCrossings/fromSession";
import { consistencyCheck, deltaCurve } from "@/lib/videoAnalysis/trace/delta";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const jobId = args.find((a) => !a.startsWith("--") && !args.includes(`--${a}`) && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!jobId) {
  console.error("usage: dev-grade-trace.mts <jobId> [--role me] [--lap N] [--vs role:lap]");
  process.exit(2);
}
const role = (flag("role") ?? "me") as DriverRole;
const lap = flag("lap") ? Number(flag("lap")) : null;
const vs = flag("vs");

const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({
  where: { id: jobId },
  include: { profile: { include: { sectorLines: { orderBy: { sortOrder: "asc" } } } } },
});
const session = parseManualVideoSession(job.manualJson);
if (!session) throw new Error("no manual session");
const traces = session.traces ?? {};
const lines = (job.profile?.sectorLines ?? []).map((l) => ({
  lineKey: l.lineKey,
  label: l.label,
  sortOrder: l.sortOrder,
  x1: l.x1,
  y1: l.y1,
  x2: l.x2,
  y2: l.y2,
}));

const pct = (v: number) => `${Math.round(v * 100)}%`;
const err = (v: number | null) => (v == null ? "  -  " : v.toFixed(2).padStart(5));
const holesOf = (t: ManualLapTrace) =>
  t.holes.map((h) => `${h.fromT.toFixed(2)}→${h.toT.toFixed(2)} ${h.why}`).join(", ") || "none";

console.log(`${job.id} · ${session.localVideoName ?? "-"} · ${lines.length} lines · ${Object.keys(traces).length} traces`);

if (lap == null) {
  for (const t of Object.values(traces).sort((a, b) => a.driverRole.localeCompare(b.driverRole) || a.lapNumber - b.lapNumber)) {
    const q = t.quality;
    console.log(
      `  ${traceKey(t.driverRole, t.lapNumber).padEnd(16)} ${q.ok ? "OK    " : "NOT OK"} coverage ${pct(q.coverage).padStart(4)} anchors ${q.anchorsHit}/${q.anchorsTotal} ambiguous ${q.ambiguousFrames} holes ${t.holes.length} points ${t.points.length} · ${(t.endSec - t.startSec).toFixed(1)}s · ${t.at.slice(0, 19)}`
    );
  }
  await prisma.$disconnect();
  process.exit(0);
}

const trace = traces[traceKey(role, lap)];
if (!trace) {
  console.error(`no trace for ${role} L${lap}; have ${Object.keys(traces).join(", ") || "none"}`);
  await prisma.$disconnect();
  process.exit(1);
}
const q = trace.quality;
console.log(
  `\n${role} L${lap} · ${trace.points.length} points over ${(trace.endSec - trace.startSec).toFixed(2)}s · ${q.ok ? "OK" : "NOT OK"} · coverage ${pct(q.coverage)} · anchors ${q.anchorsHit}/${q.anchorsTotal} · ambiguous ${q.ambiguousFrames} frames · ${trace.recipe} · ${trace.frame.w}×${trace.frame.h}`
);
console.log(`  holes: ${holesOf(trace)}`);
console.log(
  `  ${"segment".padEnd(12)} ${"from".padStart(8)} ${"to".padStart(8)} ${"cover".padStart(6)} ${"frames".padStart(7)} ${"blind".padStart(6)} ${"shake".padStart(6)} ${"errFrom".padStart(8)} ${"errTo".padStart(6)}`
);
for (const s of trace.segments) {
  const f = s.frames;
  console.log(
    `  ${`${s.fromKey}→${s.toKey}`.padEnd(12)} ${s.fromT.toFixed(2).padStart(8)} ${s.toT.toFixed(2).padStart(8)} ${pct(s.coverage).padStart(6)} ${String(f?.read ?? "—").padStart(7)} ${String(f ? f.read - f.saw : "—").padStart(6)} ${String(f?.shake ?? "—").padStart(6)} ${err(s.anchorErr.from).padStart(8)} ${err(s.anchorErr.to).padStart(6)}`
  );
}

if (vs) {
  const [otherRoleRaw, otherLapRaw] = vs.split(":");
  const otherRole = otherRoleRaw as DriverRole;
  const otherLap = Number(otherLapRaw);
  const other = traces[traceKey(otherRole, otherLap)];
  if (!other) {
    console.error(`no trace for ${otherRole} L${otherLap}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const mineIsYou = role === "me";
  const curve = deltaCurve(trace, other, {
    aspect: trace.frame.w / trace.frame.h,
    baseIsYou: mineIsYou,
  });
  // The board: cumulative splits to each line for the two laps, from the same lib the screen uses.
  const drivers = buildCompareDrivers(session, lines);
  const segs = segmentDefs(lines);
  const rowFor = (r: DriverRole, n: number) => {
    const d = drivers.find((x) => x.role === r);
    if (!d) return null;
    return lapRows(d, segs.map((s) => segmentStats(d, s))).find((row) => row.lapNumber === n) ?? null;
  };
  const you = mineIsYou ? rowFor(role, lap) : rowFor(otherRole, otherLap);
  const them = mineIsYou ? rowFor(otherRole, otherLap) : rowFor(role, lap);
  const board: Array<{ lineKey: string; youMinusThem: number }> = [];
  segs.forEach((s, i) => {
    const a = you?.cells[i];
    const b = them?.cells[i];
    if (!you || !them || !a || !b) return;
    board.push({
      lineKey: s.toKey === "end" ? SF_LINE_KEY : s.toKey,
      youMinusThem: a.window.endSec - you.window.startSec - (b.window.endSec - them.window.startSec),
    });
  });
  const check = consistencyCheck(curve, board, 0.08);
  console.log(`\ndelta line ${role} L${lap} vs ${otherRole} L${otherLap} · you minus them · total ${curve.total == null ? "-" : curve.total.toFixed(3)}s`);
  console.log(`  ${"line".padEnd(6)} ${"at".padStart(6)} ${"curve".padStart(8)} ${"board".padStart(8)} ${"diff".padStart(8)}`);
  for (const r of check.rows) {
    const tick = curve.ticks.find((t) => t.lineKey === r.lineKey);
    console.log(
      `  ${r.lineKey.padEnd(6)} ${(tick ? tick.s.toFixed(3) : "-").padStart(6)} ${(r.curve == null ? "hole" : r.curve.toFixed(3)).padStart(8)} ${r.board.toFixed(3).padStart(8)} ${(r.diff == null ? "-" : r.diff.toFixed(3)).padStart(8)}${r.diff != null && Math.abs(r.diff) > 0.08 ? "  DISAGREES" : ""}`
    );
  }
  const drawn = curve.samples.filter((s) => s.delta != null).length;
  console.log(`  ${drawn}/${curve.samples.length} samples drawn · ${check.disagreeing.length} line${check.disagreeing.length === 1 ? "" : "s"} disagree beyond 0.08s`);
}
await prisma.$disconnect();
