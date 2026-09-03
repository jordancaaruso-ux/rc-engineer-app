/**
 * One way through each line — the Bendigo S5 hairpin of 2026-09-02.
 *
 * The line sits across both legs of a hairpin, so every lap the car crosses it twice a second
 * apart in opposite directions. Jordan's windows were centred on the second pass and took it;
 * Justin's were centred on the first and took that. Same car, same corner, two different sector
 * times — and the odd-lap vote then held whichever laps disagreed with each driver's own majority.
 */
import {
  applyLineDirections,
  directionsFromMarks,
  lineDirections,
  pickedCandidate,
  withDirection,
} from "./direction";
import { reviewResults, type LapInput, type SessionTarget } from "./fromSession";
import type { RefinableResult } from "./refine";
import type { CrossingEvent } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ev = (t: number, dir: 1 | -1, source: CrossingEvent["source"] = "confirmed"): CrossingEvent => ({
  t,
  quality: 8,
  dir,
  source,
});

function row(
  id: string,
  lineKey: string,
  picked: number | null,
  candidates: CrossingEvent[],
  centerSec?: number
): RefinableResult {
  return {
    id,
    lineKey,
    lapNumber: Number(id.split(":")[1]),
    centerSec: centerSec ?? picked ?? 0,
    detectedSec: picked,
    quality: picked == null ? null : 8,
    candidates,
    source: picked == null ? null : "confirmed",
  };
}

/* ---------- a pick's direction is read off its own candidate ---------- */
{
  const r = row("me:3:s5", "s5", 52.4, [ev(52.4, -1), ev(53.5, 1)]);
  assert(pickedCandidate(r)?.dir === -1, "the pick is the first pass, heading out");
  assert(pickedCandidate(row("me:3:s5", "s5", 52.4, [])) == null, "a hand mark has no candidate");
}

/* ---------- the majority: ten laps one way outvote nine the other, and the nine are turned ---------- */
{
  const first = (s: number) => s + 1.15;
  const second = (s: number) => s + 2.2;
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => {
      const s = 100 + i * 15;
      return row(`me:${i + 1}:s5`, "s5", second(s), [ev(first(s), -1), ev(second(s), 1)], second(s));
    }),
    ...Array.from({ length: 9 }, (_, i) => {
      const s = 101 + i * 15;
      return row(`competitor:${i + 1}:s5`, "s5", first(s), [ev(first(s), -1), ev(second(s), 1)], first(s));
    }),
  ];
  const dirs = lineDirections(rows);
  assert(dirs.get("s5") === 1, `the second pass is the corner, got ${dirs.get("s5")}`);
  const out = applyLineDirections(rows, dirs);
  assert(out.turned.length === 9 && out.emptied.length === 0, `nine rows turned, got ${out.turned.length}/${out.emptied.length}`);
  for (const r of out.rows.filter((x) => x.id.startsWith("competitor"))) {
    const s = 101 + (r.lapNumber - 1) * 15;
    assert(Math.abs(r.detectedSec! - second(s)) < 1e-9, `${r.id} now measures the second pass`);
    assert(r.source === "confirmed", "the candidate's own source comes with it");
  }
  for (const r of out.rows.filter((x) => x.id.startsWith("me"))) {
    assert(r.detectedSec === second(100 + (r.lapNumber - 1) * 15), "rows already the right way are untouched");
  }
}

/* ---------- an even split goes to the driver being analysed; still even, nothing is decided ---------- */
{
  const split = [row("me:1:s5", "s5", 1.0, [ev(1.0, 1)]), row("competitor:1:s5", "s5", 2.0, [ev(2.0, -1)])];
  assert(lineDirections(split).get("s5") === 1, "one each: the driver's own pick decides");
  const even = [row("me:1:s5", "s5", 1.0, [ev(1.0, 1)]), row("me:2:s5", "s5", 2.0, [ev(2.0, -1)])];
  assert(!lineDirections(even).has("s5"), "the driver's own rows split evenly: no guess");
}

/* ---------- somebody already said ---------- */
{
  const rows = Array.from({ length: 5 }, (_, i) => {
    const s = i * 15;
    return row(`me:${i + 1}:s5`, "s5", s + 2.2, [ev(s + 1.15, -1), ev(s + 2.2, 1)]);
  });
  assert(lineDirections(rows, new Map([["s5", -1]])).get("s5") === -1, "the picker's word beats the majority");
  const marks = directionsFromMarks([
    { lineKey: "s5", dir: -1 },
    { lineKey: "s5", dir: -1 },
    { lineKey: "s5", dir: 1 },
    { lineKey: "s1" },
  ]);
  assert(marks.get("s5") === -1, "marks vote by majority");
  assert(!marks.has("s1"), "hand marks say nothing");
}

/* ---------- nothing the right way on offer: the row is emptied, not written ---------- */
{
  const rows = [
    row("me:1:s5", "s5", 2.2, [ev(1.15, -1), ev(2.2, 1)]),
    row("me:2:s5", "s5", 17.2, [ev(16.15, -1), ev(17.2, 1)]),
    // The window closed before the second pass.
    row("me:3:s5", "s5", 31.15, [ev(31.15, -1)]),
  ];
  const dirs = lineDirections(rows);
  const out = applyLineDirections(rows, dirs);
  assert(out.emptied.length === 1 && out.emptied[0] === "me:3:s5", "the lap with only the wrong pass is emptied");
  const emptied = out.rows[2]!;
  assert(emptied.detectedSec === null && emptied.source === null, "no time, no source");
  assert(emptied.candidates.length === 1, "the evidence stays on the row");
  assert(applyLineDirections(rows, dirs, new Set(["me:3:s5"])).emptied.length === 0, "a fixed row is never touched");
  const trimmed = withDirection(rows[0]!, 1);
  assert(trimmed.candidates.length === 1 && trimmed.candidates[0]!.dir === 1, "wrong-way candidates leave the row");
  assert(withDirection(rows[0]!, undefined) === rows[0], "no direction: nothing changes");
}

/* ---------- end to end: the review holds every driver to the same leg ---------- */
{
  // Two drivers, five laps each, one line at a hairpin. Jordan's windows were centred on the
  // second pass and picked it; Justin's on the first. Through the review, every row of both comes
  // out on the second pass, nothing is held, and each row still shows both passes as evidence.
  const lapStarts: Array<{ role: "me" | "competitor"; lapNumber: number; videoTimeSec: number }> = [];
  const targets: SessionTarget[] = [];
  const results: RefinableResult[] = [];
  const laps: LapInput[] = [];
  const secondOf = new Map<string, number>();
  for (const [role, start] of [["me", 40], ["competitor", 41.1]] as const) {
    for (let lap = 1; lap <= 5; lap++) {
      const s = start + (lap - 1) * 15;
      lapStarts.push({ role, lapNumber: lap, videoTimeSec: s });
      laps.push({ role, lapNumber: lap, lapTimeSec: 15 });
      const first = s + 10.4 + (lap % 3) * 0.02;
      const second = s + 11.45 + (lap % 2) * 0.03;
      const centre = role === "me" ? s + 11.45 : s + 10.4;
      const id = `${role}:${lap}:s5`;
      secondOf.set(id, second);
      targets.push({
        id,
        role,
        lineKey: "s5",
        lapNumber: lap,
        centerSec: centre,
        truthSec: null,
        searchFrom: centre - 2,
        searchTo: centre + 2,
      });
      results.push({
        id,
        lineKey: "s5",
        lapNumber: lap,
        centerSec: centre,
        detectedSec: role === "me" ? second : first,
        quality: 8,
        candidates: [ev(first, -1), ev(second, 1)],
        source: "confirmed",
      });
    }
  }
  const review = reviewResults({ results, targets, marks: [], lapStarts, laps });
  const s5 = review.directions.find((d) => d.lineKey === "s5");
  assert(s5 && s5.dir === 1 && s5.from === "majority", `the line is held to the second pass, got ${JSON.stringify(s5)}`);
  assert(s5.turned === 5 && s5.emptied === 0, `Justin's five rows turned, got ${s5.turned}/${s5.emptied}`);
  assert(review.suspect.length === 0, `nothing held once every lap measures the same leg, held ${review.suspect.length}`);
  assert(review.found.length === 10, `all ten written, got ${review.found.length}`);
  for (const r of review.found) {
    assert(r.dir === 1, `${r.id} carries the line's direction`);
    assert(Math.abs(r.videoTimeSec - secondOf.get(r.id)!) < 1e-9, `${r.id} is the second pass`);
    assert(r.candidates.length === 2, `${r.id} still shows both passes as evidence`);
  }

  // The marks a scan writes carry the direction, and a later scan takes it from them even when
  // its own rows lean the other way.
  const marks = review.found.map((r) => ({
    driverRole: r.role,
    lapNumber: r.lapNumber + 100,
    lineKey: r.lineKey,
    videoTimeSec: r.videoTimeSec + 1000,
    dir: r.dir,
  }));
  const leaning = results.map((r) => ({ ...r, detectedSec: r.candidates[0]!.t }));
  const again = reviewResults({ results: leaning, targets, marks, lapStarts, laps });
  const s5again = again.directions.find((d) => d.lineKey === "s5");
  assert(s5again?.dir === 1 && s5again.from === "marks", "the earlier scan's marks settle it");
  assert(s5again.turned === 10, "every leaning row is turned back");
}

console.log("direction.test.ts: OK");
