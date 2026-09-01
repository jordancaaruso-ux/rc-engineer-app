/**
 * Replay the review's hold rules over a job's SAVED scan and say what changes.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-replay-review.mts <jobId> [<jobId> ...]
 *
 * Nothing is re-detected. A scan (2026-08-28+) saves every row with its source, its candidates
 * and whether the review held it (`manualJson.lastScan`); this rebuilds the same inputs, runs the
 * CURRENT `flagImplausible` / `flagOutOfOrder` / `vouchedUnconfirmed`, keeps the saved field
 * claims (the field is replayed by `dev-replay-field.mts`), and prints per driver and line how
 * many rows were held then and would be held now, with every row that changed and its offset from
 * the driver's own lap start. Then both sets are graded the only way that needs no watching: the
 * gap between the same line on consecutive laps against the transponder lap time.
 *
 * Lap starts are walked from the race tone on each driver's own lap times, the same way the scan
 * does it — under an `sf_finish` anchor the walk starts one lap-1 earlier.
 */
import { PrismaClient } from "@prisma/client";
import {
  flagImplausible,
  flagOutOfOrder,
  vouchedUnconfirmed,
  type RefinableResult,
} from "@/lib/videoAnalysis/findCrossings/refine";

const prisma = new PrismaClient();
const SF = "sf";
type Candidate = { t: number; quality: number };
type Row = {
  driverRole: "me" | "competitor";
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number | null;
  source: string | null;
  suspect: boolean;
  claimedBy?: { by: string; key: string; lapNumber: number };
  candidates: Candidate[];
};
type Lap = { lapNumber: number; lapTimeSec: number };
type Driver = { role: "me" | "competitor" | "other"; driverName: string; laps: Lap[] };

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN;
};

async function replay(jobId: string) {
  const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
  const m = job.manualJson as Record<string, unknown>;
  const scan = m.lastScan as { at: string; rows: Row[] } | undefined;
  if (!scan) {
    console.log(`${jobId}: no saved scan`);
    return;
  }
  const sessions =
    (m.timingSessions as Array<{
      isOnVideo: boolean;
      sync: { anchor: { videoTimeSec: number; anchorKind: string } };
      drivers: Driver[];
    }>) ?? [];
  const primary = sessions.find((s) => s.isOnVideo) ?? sessions[0]!;
  const anchor = primary.sync.anchor;
  const me = primary.drivers.find((d) => d.role === "me")!;
  const tone =
    anchor.videoTimeSec -
    (anchor.anchorKind === "sf_finish" ? (me.laps.find((l) => l.lapNumber === 1)?.lapTimeSec ?? 0) : 0);

  const results: RefinableResult[] = [];
  const startOf = new Map<string, number>();
  const lapTimeOf = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const d of primary.drivers) {
    if (d.role === "other") continue;
    nameOf.set(d.role, d.driverName);
    let t = tone;
    for (const lap of [...d.laps].sort((a, b) => a.lapNumber - b.lapNumber)) {
      startOf.set(`${d.role}:${lap.lapNumber}`, t);
      lapTimeOf.set(`${d.role}:${lap.lapNumber}`, lap.lapTimeSec);
      results.push({
        id: `${d.role}:${lap.lapNumber}:${SF}`,
        lineKey: SF,
        lapNumber: lap.lapNumber,
        centerSec: t,
        detectedSec: t,
        quality: null,
        candidates: [],
        source: "confirmed",
      });
      t += lap.lapTimeSec;
    }
  }
  const rows = scan.rows.filter((r) => r.lineKey !== SF);
  for (const r of rows) {
    results.push({
      id: `${r.driverRole}:${r.lapNumber}:${r.lineKey}`,
      lineKey: r.lineKey,
      lapNumber: r.lapNumber,
      centerSec: r.videoTimeSec ?? r.candidates[0]?.t ?? 0,
      detectedSec: r.videoTimeSec,
      quality: null,
      candidates: r.candidates.map((c) => ({ t: c.t, quality: c.quality })),
      source: (r.source as RefinableResult["source"]) ?? "unconfirmed",
    });
  }
  const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");
  const live = results.filter((r) => r.detectedSec != null);
  const odd = flagImplausible(live, SF, lapKey);
  const outOfOrder = flagOutOfOrder(live, SF, lapKey);
  const vouched = vouchedUnconfirmed(live, SF, lapKey, odd);

  const idOf = (r: Row) => `${r.driverRole}:${r.lapNumber}:${r.lineKey}`;
  const nowHeld = (r: Row) =>
    r.videoTimeSec != null &&
    (odd.has(idOf(r)) ||
      outOfOrder.has(idOf(r)) ||
      (r.source === "unconfirmed" && !vouched.has(idOf(r))) ||
      r.claimedBy != null);
  const why = (r: Row) =>
    [
      odd.has(idOf(r)) ? "odd" : "",
      outOfOrder.has(idOf(r)) ? "out-of-order" : "",
      r.source === "unconfirmed" ? (vouched.has(idOf(r)) ? "unconfirmed-but-vouched" : "unconfirmed") : "",
      r.claimedBy ? `claimed by ${r.claimedBy.by}` : "",
    ]
      .filter(Boolean)
      .join(", ");

  console.log(`\n=== ${jobId}  (${String(m.localVideoName ?? "")}, scan ${scan.at})`);
  const withTime = rows.filter((r) => r.videoTimeSec != null);
  const before = withTime.filter((r) => r.suspect).length;
  const after = withTime.filter(nowHeld).length;
  console.log(`rows with a time: ${withTime.length}   held then: ${before}   held now: ${after}   missing: ${rows.length - withTime.length}`);

  const groups = new Map<string, Row[]>();
  for (const r of withTime) {
    const k = `${r.driverRole}|${r.lineKey}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, g] of [...groups].sort()) {
    const then = g.filter((r) => r.suspect).length;
    const now = g.filter(nowHeld).length;
    const changed = g.filter((r) => r.suspect !== nowHeld(r));
    console.log(`  ${k.padEnd(16)} n=${g.length}  held then=${then}  now=${now}${changed.length ? "" : ""}`);
    for (const r of changed.sort((a, b) => a.lapNumber - b.lapNumber)) {
      const off = r.videoTimeSec! - (startOf.get(`${r.driverRole}:${r.lapNumber}`) ?? NaN);
      console.log(
        `      L${String(r.lapNumber).padStart(2)} t=${r.videoTimeSec!.toFixed(2)} own-offset=${off.toFixed(2)} ${r.source}  ${r.suspect ? "HELD → ready" : "ready → HELD"}  ${why(r) || "fits"}`
      );
    }
  }

  // Grade: same line, consecutive laps, against the transponder lap time.
  const grade = (label: string, keep: (r: Row) => boolean) => {
    const out: string[] = [];
    for (const role of ["me", "competitor"] as const) {
      const mine = withTime.filter((r) => r.driverRole === role && keep(r));
      const parts: string[] = [];
      for (const line of [...new Set(mine.map((r) => r.lineKey))].sort()) {
        const at = new Map(mine.filter((r) => r.lineKey === line).map((r) => [r.lapNumber, r.videoTimeSec!]));
        const errs: number[] = [];
        for (const [lap, t] of at) {
          const next = at.get(lap + 1);
          const lt = lapTimeOf.get(`${role}:${lap + 1}`);
          if (next == null || lt == null) continue;
          errs.push(Math.abs(next - t - lt) * 1000);
        }
        parts.push(`${line} n=${at.size} pairs=${errs.length} med=${errs.length ? med(errs).toFixed(0) : "—"}ms worst=${errs.length ? Math.max(...errs).toFixed(0) : "—"}ms`);
      }
      out.push(`    ${(nameOf.get(role) ?? role).padEnd(16)} ${parts.join(" · ")}`);
    }
    console.log(`  ${label}`);
    for (const l of out) console.log(l);
  };
  grade("kept THEN:", (r) => !r.suspect);
  grade("kept NOW:", (r) => !nowHeld(r));
}

for (const id of process.argv.slice(2)) await replay(id);
await prisma.$disconnect();
