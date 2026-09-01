/**
 * Replay the field assignment over a job's SAVED scan: which crossings does the whole field's
 * timing give to somebody else, and what would it hand this driver instead?
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-replay-field.mts <jobId>
 *
 * Nothing is re-detected. Since 2026-08-28 a scan saves every row with every candidate the
 * window saw (`manualJson.lastScan`), so this is a true replay — the same inputs the review had.
 * On an older job only the marks exist, each carrying no alternatives, and the replay can only
 * say "that was X's car", never swap it for the right one.
 */
import { PrismaClient } from "@prisma/client";
import { assignToField, type FieldDriver } from "@/lib/videoAnalysis/findCrossings/field";
import type { RefinableResult } from "@/lib/videoAnalysis/findCrossings/refine";

const prisma = new PrismaClient();
const jobId = process.argv[2]!;
type Candidate = { t: number; quality: number; colour?: { r: number; g: number; b: number } };
type Mark = { driverRole: "me" | "competitor"; lapNumber: number; lineKey: string; videoTimeSec: number; candidates?: Candidate[] };
type ScanRow = Mark & { videoTimeSec: number | null; source: string | null; suspect: boolean; candidates: Candidate[] };
type Lap = { lapNumber: number; lapTimeSec: number };
type Driver = { key: string; role: "me" | "competitor" | "other"; driverName: string; laps: Lap[] };

const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const m = job.manualJson as Record<string, unknown>;
const marks = (m.marks as Mark[]) ?? [];
const lastScan = m.lastScan as { at: string; rows: ScanRow[] } | undefined;
const sessions =
  (m.timingSessions as Array<{ isOnVideo: boolean; sync: { anchor: { videoTimeSec: number; anchorKind: string } }; drivers: Driver[] }>) ?? [];
const primary = sessions.find((s) => s.isOnVideo) ?? sessions[0]!;
const anchor = primary.sync.anchor;

// Lap starts for everyone, walked from the one race anchor on their own lap times. Under a
// corrected anchor (a crossing that ENDS lap 1) the walk starts one L1 earlier, at the tone.
const me = primary.drivers.find((d) => d.role === "me")!;
const tone = anchor.videoTimeSec - (anchor.anchorKind === "sf_finish" ? (me.laps.find((l) => l.lapNumber === 1)?.lapTimeSec ?? 0) : 0);
const field: FieldDriver[] = primary.drivers.map((d) => {
  let t = tone;
  const lapStarts: FieldDriver["lapStarts"] = [];
  for (const lap of [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber)) {
    lapStarts.push({ lapNumber: lap.lapNumber, startSec: t });
    t += lap.lapTimeSec;
  }
  return { key: d.role === "other" ? d.key : d.role, name: d.driverName, role: d.role === "other" ? undefined : d.role, lapStarts };
});

const source = lastScan ? lastScan.rows : marks.map((mk) => ({ ...mk, source: null, suspect: false, candidates: mk.candidates ?? [] }));
const results: RefinableResult[] = source.map((r) => ({
  id: `${r.driverRole}:${r.lapNumber}:${r.lineKey}`,
  lineKey: r.lineKey,
  lapNumber: r.lapNumber,
  centerSec: r.videoTimeSec ?? r.candidates[0]?.t ?? 0,
  detectedSec: r.videoTimeSec,
  quality: null,
  candidates: r.candidates,
  source: (r.source as RefinableResult["source"]) ?? "unconfirmed",
}));

const a = assignToField({ results, field, sfKey: "sf" });
console.log(
  `${lastScan ? `saved scan of ${lastScan.at}: ${source.length} rows` : `${marks.length} saved marks (no saved scan — marks only)`} · field of ${field.length} · offsets ${[...a.offsets].map(([k, v]) => `${k}=${v.toFixed(2)}s`).join(" ")}`
);
for (const [line, byDriver] of a.rivalOffsets) {
  console.log(`   ${line}: rivals' own offsets ${[...byDriver].map(([k, v]) => `${field.find((d) => d.key === k)?.name ?? k} ${v.toFixed(2)}s`).join(" · ")}`);
}
console.log(
  a.colourLines.size
    ? `colour had a say on ${[...a.colourLines].map(([line, roles]) => `${line} (${roles.join(", ")})`).join(" · ")}`
    : "colour had no say on any line — references not usable (too few samples, or rivals too close in colour)"
);
console.log(`\nthe field gives ${a.claimed.size} of them to somebody else:`);
const nameOf = new Map(field.map((d) => [d.key, d.name]));
for (const [id, c] of [...a.claimed].sort()) {
  const [role, lap, line] = id.split(":");
  const who = nameOf.get(role!) ?? role;
  const alt = a.pick.get(id);
  console.log(`   ${who} L${lap} ${line}  →  ${c.by} L${c.lapNumber}${c.key === role ? "  (own car, other lap)" : ""}${alt ? `  · instead: ${alt.t.toFixed(3)}` : "  · nothing else fits"}`);
}
await prisma.$disconnect();
