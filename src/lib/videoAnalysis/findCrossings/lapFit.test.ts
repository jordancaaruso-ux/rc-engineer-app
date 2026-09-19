/**
 * A lap is fitted whole — the Bendigo practice of 2026-09-03 (IMG_4521), lap 14.
 *
 * One corner produced no candidate; the window took a stranger 1.4s late; the old chain anchored
 * on it and every later corner followed, though the right crossing sat in three of those pools.
 */
import { refineByLapFit } from "./lapFit";
import type { RefinableResult } from "./refine";
import type { CrossingEvent } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SF = "sf";
const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");
const LINES = ["s1", "s2", "s3", "s4"] as const;
/** How far into a lap each corner sits. */
const USUAL: Record<string, number> = { s1: 2.3, s2: 4.1, s3: 6.5, s4: 9.3 };
const LAP_SEC = 15;

const ev = (
  t: number,
  extra: Partial<CrossingEvent> = {}
): CrossingEvent => ({ t, quality: 8, source: "confirmed", dir: 1, ...extra });

function sfRow(lap: number): RefinableResult {
  const t = lap * LAP_SEC;
  return {
    id: `me:${lap}:${SF}`,
    lineKey: SF,
    lapNumber: lap,
    centerSec: t,
    detectedSec: t,
    quality: null,
    candidates: [],
    source: "confirmed",
  };
}

function row(lap: number, line: string, picked: number | null, candidates: CrossingEvent[]): RefinableResult {
  return {
    id: `me:${lap}:${line}`,
    lineKey: line,
    lapNumber: lap,
    centerSec: lap * LAP_SEC + USUAL[line]!,
    detectedSec: picked,
    quality: picked == null ? null : 8,
    candidates,
    source: picked == null ? null : "confirmed",
  };
}

/** Seven clean laps: every corner found at its usual place, one candidate each. */
function cleanLaps(count: number): RefinableResult[] {
  const out: RefinableResult[] = [];
  for (let lap = 1; lap <= count; lap++) {
    out.push(sfRow(lap));
    for (const line of LINES) {
      const t = lap * LAP_SEC + USUAL[line]!;
      out.push(row(lap, line, t, [ev(t)]));
    }
  }
  return out;
}

type Fitted = RefinableResult & { movedBy?: number; emptiedByFit?: boolean };
const fixedIds = (rows: RefinableResult[]) => new Set(rows.filter((r) => r.lineKey === SF).map((r) => r.id));
const at = (rows: Fitted[], id: string) => rows.find((r) => r.id === id)!;

/* ---------- one miss, then strangers: the fit takes the right crossings back ---------- */
{
  const rows = cleanLaps(7);
  const lap = 8;
  const s = lap * LAP_SEC;
  rows.push(sfRow(lap));
  // S1 is right. S2 has only a stranger 1.4s late. S3 and S4 offer the stranger (1.4s late,
  // chain-consistent with the wrong S2) AND the driver's own crossing; the old chain took the
  // strangers, so those are the rows' picks going in.
  rows.push(row(lap, "s1", s + 2.3, [ev(s + 2.3)]));
  rows.push(row(lap, "s2", s + 4.1 + 1.4, [ev(s + 4.1 + 1.4)]));
  rows.push(row(lap, "s3", s + 6.5 + 1.4, [ev(s + 6.5), ev(s + 6.5 + 1.4)]));
  rows.push(row(lap, "s4", s + 9.3 + 1.4, [ev(s + 9.3), ev(s + 9.3 + 1.4)]));

  const out = refineByLapFit(rows, SF, lapKey, { fixed: fixedIds(rows) });
  assert(Math.abs(at(out, "me:8:s3").detectedSec! - (s + 6.5)) < 1e-9, "S3 goes back to the driver's own crossing");
  assert(Math.abs(at(out, "me:8:s4").detectedSec! - (s + 9.3)) < 1e-9, "S4 goes back to the driver's own crossing");
  assert(at(out, "me:8:s3").movedBy != null, "a moved row says so");
  // The stranger on S2 is left for the vote: nothing fitted, and it crossed the right way.
  assert(Math.abs(at(out, "me:8:s2").detectedSec! - (s + 5.5)) < 1e-9, "S2 keeps the window's answer for the vote");
  assert(at(out, "me:8:s1").detectedSec === s + 2.3, "a right pick is untouched");
  for (const r of out) {
    if (r.lineKey === SF || r.detectedSec == null) continue;
    assert(r.candidates.some((c) => Math.abs(c.t - r.detectedSec!) < 1e-9), `${r.id} only ever holds a time a candidate had`);
  }
}

/* ---------- a slow start is not a wrong lap: consistent gaps carry it through ---------- */
{
  const rows = cleanLaps(7);
  const lap = 8;
  const s = lap * LAP_SEC;
  rows.push(sfRow(lap));
  // Lost 1.5s in the first sector, then drove normally: every corner 1.5s late, gaps exact.
  for (const line of LINES) {
    const t = s + USUAL[line]! + 1.5;
    rows.push(row(lap, line, t, [ev(t)]));
  }
  const out = refineByLapFit(rows, SF, lapKey, { fixed: fixedIds(rows) });
  for (const line of LINES) {
    const r = at(out, `me:8:${line}`);
    assert(Math.abs(r.detectedSec! - (s + USUAL[line]! + 1.5)) < 1e-9, `${line} on the slow lap is kept`);
    assert(r.movedBy == null, `${line} was not moved`);
  }
}

/* ---------- a slow lap with a stranger sitting exactly where the corner usually is ---------- */
{
  // IMG_4523 lap 1, the warm-up: every corner 1.3s late, and on S3 another car crossed at the
  // driver's USUAL offset. Judged line by line that stranger looks like the corner; judged as a
  // lap that runs 1.3s late, it does not.
  const rows = cleanLaps(7);
  const lap = 8;
  const s = lap * LAP_SEC;
  rows.push(sfRow(lap));
  for (const line of LINES) {
    const t = s + USUAL[line]! + 1.3;
    const cands = [ev(t)];
    if (line === "s3") cands.unshift(ev(s + USUAL[line]!));
    rows.push(row(lap, line, t, cands));
  }
  const out = refineByLapFit(rows, SF, lapKey, { fixed: fixedIds(rows) });
  for (const line of LINES) {
    const r = at(out, `me:8:${line}`);
    assert(Math.abs(r.detectedSec! - (s + USUAL[line]! + 1.3)) < 1e-9, `${line} keeps the late crossing, not the stranger at the usual spot`);
  }
}

/* ---------- direction is a penalty: the return leg loses, a wrong-way read at the usual spot wins ---------- */
{
  const dirs = new Map<string, 1 | -1>([["s3", 1]]);
  const rows = cleanLaps(7);
  // Every lap's S3 also sees the hairpin's return leg 1.05s later, the other way round.
  for (const r of rows) if (r.lineKey === "s3") r.candidates.push(ev(r.detectedSec! + 1.05, { dir: -1 }));

  // Lap 8: the corner pass was missed; only the return leg is there, and the window picked it.
  const s8 = 8 * LAP_SEC;
  rows.push(sfRow(8));
  for (const line of LINES) {
    if (line === "s3") rows.push(row(8, line, s8 + 6.5 + 1.05, [ev(s8 + 6.5 + 1.05, { dir: -1 })]));
    else rows.push(row(8, line, s8 + USUAL[line]!, [ev(s8 + USUAL[line]!)]));
  }
  // Lap 9: the pass is there but its direction read backwards, and nothing else was seen.
  const s9 = 9 * LAP_SEC;
  rows.push(sfRow(9));
  for (const line of LINES) {
    if (line === "s3") rows.push(row(9, line, null, [ev(s9 + 6.5, { dir: -1 })]));
    else rows.push(row(9, line, s9 + USUAL[line]!, [ev(s9 + USUAL[line]!)]));
  }

  const out = refineByLapFit(rows, SF, lapKey, { fixed: fixedIds(rows), dirs });
  for (let lap = 1; lap <= 7; lap++) {
    assert(Math.abs(at(out, `me:${lap}:s3`).detectedSec! - (lap * LAP_SEC + 6.5)) < 1e-9, `lap ${lap} keeps the corner pass`);
  }
  const eight = at(out, "me:8:s3");
  assert(eight.detectedSec == null && eight.emptiedByFit, "the return leg alone is emptied, not written");
  const nine = at(out, "me:9:s3");
  assert(Math.abs(nine.detectedSec! - (s9 + 6.5)) < 1e-9, "a wrong-way read at the usual spot is the car");
}

/* ---------- too few laps to know a rhythm: the window's answers stand ---------- */
{
  const rows = cleanLaps(2);
  const s = 2 * LAP_SEC;
  at(rows, "me:2:s3").candidates.push(ev(s + 6.5 + 0.4));
  const out = refineByLapFit(rows, SF, lapKey, { fixed: fixedIds(rows) });
  for (const r of rows) {
    if (r.lineKey === SF) continue;
    assert(at(out, r.id).detectedSec === r.detectedSec, `${r.id} unchanged with nothing learnt`);
  }
}

/* ---------- a hand mark is on the path and never moved ---------- */
{
  const rows = cleanLaps(7);
  const s = 8 * LAP_SEC;
  rows.push(sfRow(8));
  const mark: RefinableResult = { ...row(8, "s2", s + 4.1, []), source: "confirmed" };
  rows.push(row(8, "s1", s + 2.3, [ev(s + 2.3)]));
  rows.push(mark);
  rows.push(row(8, "s3", s + 6.5 + 1.4, [ev(s + 6.5), ev(s + 6.5 + 1.4)]));
  rows.push(row(8, "s4", s + 9.3, [ev(s + 9.3)]));
  const fixed = new Set([...fixedIds(rows), mark.id]);
  const out = refineByLapFit(rows, SF, lapKey, { fixed });
  assert(at(out, "me:8:s2").detectedSec === s + 4.1, "the mark stands");
  assert(Math.abs(at(out, "me:8:s3").detectedSec! - (s + 6.5)) < 1e-9, "S3 chains from the mark");
}

console.log("lapFit: ok");
