/**
 * The field assignment, on the shape of the Boronia race of 2026-08-26: six cars, seventeen-second
 * laps, and on Jordan's lap 12 every corner written as Chris Kalfoglou's car — 0.8–1.1s early,
 * because Chris was the nearest moving thing to where Jordan was due. Chris's own lap starts said
 * he was due exactly there. Nobody asked.
 */
import { applyFieldAssignment, assignToField, hungarian, type FieldDriver } from "./field";
import type { RefinableResult } from "./refine";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SF = "sf";

/* ---------- the solver itself ---------- */
{
  const m = hungarian([
    [4, 1, 3],
    [2, 0, 5],
    [3, 2, 2],
  ]);
  // Least total: row0→col1 (1), row1→col0 (2), row2→col2 (2) = 5.
  assert(m.join(",") === "1,0,2", `hungarian picked ${m.join(",")}`);
  assert(hungarian([]).length === 0, "empty matrix");
  assert(hungarian([[7]]).join() === "0", "1x1");
}

/* ---------- a race field, laid out like Boronia ---------- */

/** Lap starts walked from one tone, each driver on their own lap times. */
function driver(
  key: string,
  name: string,
  role: FieldDriver["role"],
  lapTimes: number[],
  tone = 10
): FieldDriver {
  const lapStarts: FieldDriver["lapStarts"] = [];
  let t = tone;
  lapTimes.forEach((lt, i) => {
    lapStarts.push({ lapNumber: i + 1, startSec: t });
    t += lt;
  });
  return { key, name, role, lapStarts };
}

// Jordan: steady 17.5s laps. Chris: 17.38s laps from three-quarters of a second later, so he
// catches up an eighth a lap — alongside around lap 7, ~0.6s ahead on the clock by lap 12, the
// shape of the real error. Sandy starts a second early on 17.8s laps and drifts back through
// Jordan around lap 4. Where two cars are a few hundredths apart (lap 7) only a hair separates
// their fits, and the rule is that a hair is not evidence: the detector's pick stands.
const jordan = driver("me", "JORDAN CARUSO", "me", Array(14).fill(17.5));
const chris = driver("chris", "CHRIS KALFOGLOU", undefined, Array(14).fill(17.38), 10.75);
const sandy = driver("competitor", "SANDY IAVAZZO", "competitor", Array(14).fill(17.8), 9.0);
const field = [jordan, chris, sandy];

const OFFSET = 8.75; // s3 sits 8.75s into a lap for everybody

function start(d: FieldDriver, lap: number) {
  return d.lapStarts.find((l) => l.lapNumber === lap)!.startSec;
}

/** A scanned row for one driver's lap on s3, with whatever candidates the window saw. */
function row(role: "me" | "competitor", lap: number, detectedSec: number | null, candidates: number[]): RefinableResult {
  return {
    id: `${role}:${lap}:s3`,
    lineKey: "s3",
    lapNumber: lap,
    centerSec: start(role === "me" ? jordan : sandy, lap) + OFFSET,
    detectedSec,
    quality: 8,
    candidates: candidates.map((t) => ({ t, quality: 7 })),
    source: "confirmed",
  };
}

{
  // Laps 2–11 clean: Jordan's car found at his own offset. On lap 12 the window saw two cars —
  // Chris's at Chris's expected moment and Jordan's a second later — and the nearest-to-prediction
  // rule picked Chris (his prediction was a touch late that lap).
  const rows: RefinableResult[] = [];
  for (let lap = 2; lap <= 11; lap++) {
    const t = start(jordan, lap) + OFFSET + (lap % 2 ? 0.05 : -0.04);
    rows.push(row("me", lap, t, [t]));
  }
  const chrisAt12 = start(chris, 12) + OFFSET;
  const jordanAt12 = start(jordan, 12) + OFFSET + 0.1;
  assert(Math.abs(chrisAt12 - jordanAt12) < 0.8 && chrisAt12 < jordanAt12, "the test needs Chris inside Jordan's gate and earlier");
  rows.push(row("me", 12, chrisAt12, [chrisAt12, jordanAt12]));

  const a = assignToField({ results: rows, field, sfKey: SF });
  assert(Math.abs((a.offsets.get("s3") ?? 0) - OFFSET) < 0.1, `learnt offset ${a.offsets.get("s3")}`);
  const claim = a.claimed.get("me:12:s3");
  assert(claim && claim.by === "CHRIS KALFOGLOU" && claim.lapNumber === 12, `lap 12 should be Chris's, got ${JSON.stringify(claim)}`);
  const pick = a.pick.get("me:12:s3");
  assert(pick && Math.abs(pick.t - jordanAt12) < 0.01, "Jordan's own slot should get the later car");
  for (let lap = 2; lap <= 11; lap++) assert(!a.claimed.has(`me:${lap}:s3`), `clean lap ${lap} must not be claimed`);

  const applied = applyFieldAssignment(rows, a, new Set());
  const l12 = applied.find((r) => r.id === "me:12:s3")!;
  assert(Math.abs(l12.detectedSec! - jordanAt12) < 0.01, "the row is moved onto Jordan's car");
  assert(l12.source === "rescued" && l12.movedBy != null, "a moved row says so");
  assert(!("claimedBy" in l12), "moved, so not merely labelled");
}

{
  // Same again, but the window never saw Jordan's car on lap 12 — only Chris's. The honest answer
  // is a labelled row the review holds back, never a guess.
  const rows: RefinableResult[] = [];
  for (let lap = 2; lap <= 11; lap++) {
    const t = start(jordan, lap) + OFFSET;
    rows.push(row("me", lap, t, [t]));
  }
  const chrisAt12 = start(chris, 12) + OFFSET;
  rows.push(row("me", 12, chrisAt12, [chrisAt12]));
  const a = assignToField({ results: rows, field, sfKey: SF });
  assert(a.claimed.get("me:12:s3")?.by === "CHRIS KALFOGLOU", "still Chris's car");
  assert(a.pick.get("me:12:s3") === null, "nothing left for Jordan's slot");
  const applied = applyFieldAssignment(rows, a, new Set());
  const l12 = applied.find((r) => r.id === "me:12:s3")!;
  assert(l12.claimedBy?.by === "CHRIS KALFOGLOU", "kept and labelled");
  assert(l12.detectedSec === chrisAt12, "the time is not changed — it is shown, not written");
}

{
  // Two scanned drivers sharing one window: Sandy's row and Jordan's row see the same two cars.
  // Each must get their own, and neither may be claimed.
  const rows: RefinableResult[] = [];
  for (let lap = 2; lap <= 6; lap++) {
    const tj = start(jordan, lap) + OFFSET;
    const ts = start(sandy, lap) + OFFSET;
    rows.push(row("me", lap, tj, [tj, ts]));
    rows.push(row("competitor", lap, ts, [tj, ts]));
  }
  const a = assignToField({ results: rows, field, sfKey: SF });
  assert(a.claimed.size === 0, `nothing should be claimed, got ${[...a.claimed.keys()].join(" ")}`);
  for (let lap = 2; lap <= 6; lap++) {
    assert(Math.abs(a.pick.get(`me:${lap}:s3`)!.t - (start(jordan, lap) + OFFSET)) < 0.01, "Jordan keeps his");
    assert(Math.abs(a.pick.get(`competitor:${lap}:s3`)!.t - (start(sandy, lap) + OFFSET)) < 0.01, "Sandy keeps hers");
  }
}

{
  // A hand mark is never touched, even when the field disagrees with it.
  const rows: RefinableResult[] = [];
  for (let lap = 2; lap <= 6; lap++) {
    const t = start(jordan, lap) + OFFSET;
    rows.push(row("me", lap, t, [t]));
  }
  const chrisAt12 = start(chris, 12) + OFFSET;
  rows.push(row("me", 12, chrisAt12, []));
  const a = assignToField({ results: rows, field, sfKey: SF });
  assert(a.claimed.has("me:12:s3"), "the field disagrees with the mark");
  const applied = applyFieldAssignment(rows, a, new Set(["me:12:s3"]));
  const l12 = applied.find((r) => r.id === "me:12:s3")!;
  assert(!("claimedBy" in l12) && l12.detectedSec === chrisAt12, "a fixed row passes through untouched");
}

{
  // Too little to go on: one lap on a line gives no repeatable offset, so the field has no opinion.
  const t = start(jordan, 3) + OFFSET;
  const a = assignToField({ results: [row("me", 3, t, [t])], field, sfKey: SF });
  assert(a.pick.size === 0 && a.claimed.size === 0, "no opinion without a repeatable offset");
}

/* ---------- a rival who takes a different line learns their own offset ---------- */
{
  // Chris reaches s3 0.45s later into his lap than Jordan does. At the pooled offset his
  // expected moment sits 0.45s before his real crossings — right where a hair separates him
  // from Jordan on the laps they run close. Once his own offset is learnt, his crossings are his
  // by a clear margin, and Jordan's stay Jordan's.
  // This Chris runs 17.35s laps, so on the clock he closes on Jordan by 0.15s a lap and the two
  // cars are never at the line within the same two frames — that would be one blob, and one
  // blob is nobody's to split. At the pooled offset his expected moment lands ON Jordan's car
  // around laps 6–7, and the first pass hands Jordan's crossing to him there.
  const CHRIS_OFFSET = OFFSET + 0.375;
  const chris35 = driver("chris", "CHRIS KALFOGLOU", undefined, Array(14).fill(17.35), 10.75);
  const fieldB = [jordan, chris35, sandy];
  const rows: RefinableResult[] = [];
  for (let lap = 2; lap <= 12; lap++) {
    const tj = start(jordan, lap) + OFFSET;
    const tc = start(chris35, lap) + CHRIS_OFFSET;
    assert(Math.abs(tc - tj) > 0.06, `test geometry: lap ${lap} puts both cars in one blob`);
    // Both cars cross every lap; the window around Jordan sees both when they are close.
    const cands = Math.abs(tc - tj) < 1.5 ? [tj, tc] : [tj];
    rows.push(row("me", lap, tj, cands));
  }
  const a = assignToField({ results: rows, field: fieldB, sfKey: SF });
  const learnt = a.rivalOffsets.get("s3")?.get("chris");
  assert(learnt != null && Math.abs(learnt - CHRIS_OFFSET) < 0.1, `Chris's own offset should be learnt, got ${learnt}`);
  assert(a.claimed.size === 0, `nothing of Jordan's should be claimed, got ${[...a.claimed.keys()].join(" ")}`);
  for (let lap = 2; lap <= 12; lap++) {
    const p = a.pick.get(`me:${lap}:s3`);
    assert(p && Math.abs(p.t - (start(jordan, lap) + OFFSET)) < 0.01, `lap ${lap}: Jordan keeps his own crossing`);
  }
}

/* ---------- colour, per line, once it has earned a say ---------- */
{
  const pink = { r: 230, g: 80, b: 160 };
  const red = { r: 200, g: 40, b: 40 };
  // Chris as in the offset test: 17.35s laps, crossing s3 0.375s later into his lap. On laps
  // 2–11 the window sees both cars — Jordan's pink, Chris's red — and the first pass hands each
  // their own, which is where the line's colour references come from.
  const CHRIS_OFFSET = OFFSET + 0.375;
  const chris35 = driver("chris", "CHRIS KALFOGLOU", undefined, Array(14).fill(17.35), 10.75);
  const base = (colours: boolean): RefinableResult[] => {
    const rows: RefinableResult[] = [];
    for (let lap = 2; lap <= 11; lap++) {
      const tj = start(jordan, lap) + OFFSET;
      const tc = start(chris35, lap) + CHRIS_OFFSET;
      rows.push({
        ...row("me", lap, tj, []),
        candidates: [
          { t: tj, quality: 7, ...(colours ? { colour: pink } : {}) },
          { t: tc, quality: 7, ...(colours ? { colour: red } : {}) },
        ],
      });
    }
    return rows;
  };
  // Lap 12: only one car seen, 0.2s before Jordan is due — inside the plain margin, so timing
  // alone leaves it Jordan's. Chris's lap 12 is placed so that he is due exactly then.
  const hair = start(jordan, 12) + OFFSET - 0.2;
  const fieldC = [jordan, chris35, sandy].map((d) =>
    d.key === "chris"
      ? { ...d, lapStarts: d.lapStarts.map((l) => (l.lapNumber === 12 ? { ...l, startSec: hair - CHRIS_OFFSET } : l)) }
      : d
  );
  const seen = (colour?: { r: number; g: number; b: number }) => ({
    ...row("me", 12, hair, []),
    candidates: [{ t: hair, quality: 7, ...(colour ? { colour } : {}) }],
  });

  // It is RED, and this line has proven pink and red tellable apart: given to Chris.
  const withColour = assignToField({ results: [...base(true), seen(red)], field: fieldC, sfKey: SF });
  assert(withColour.colourLines.get("s3")?.includes("me"), "s3 should have a usable colour for Jordan");
  assert(withColour.claimed.get("me:12:s3")?.key === "chris", "a clearly wrong colour is given away");

  // No colours at all: nothing has earned a say, the margin rule stands, Jordan keeps it.
  const without = assignToField({ results: [...base(false), seen()], field: fieldC, sfKey: SF });
  assert(!without.colourLines.has("s3"), "no colour, no say");
  assert(!without.claimed.has("me:12:s3"), "without colour the margin rule stands");

  // It is PINK: Chris's slot pays for taking a car that looks like Jordan's, and Jordan keeps it.
  const keep = assignToField({ results: [...base(true), seen(pink)], field: fieldC, sfKey: SF });
  assert(!keep.claimed.has("me:12:s3"), "a pink car stays Jordan's");
  assert(Math.abs((keep.pick.get("me:12:s3")?.t ?? 0) - hair) < 0.01, "and it is the one his slot holds");
}

console.log("findCrossings field.test.ts OK");
