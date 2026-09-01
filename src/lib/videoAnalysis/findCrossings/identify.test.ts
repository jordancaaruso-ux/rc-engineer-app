/**
 * The picker's hint: what the start-line colour may say about a picture, and when it must stay
 * quiet. Every colour here is a chroma MEASURED on the Boronia race of 2026-08-28: the pink car at
 * the start line and again at a corner, Sandy's red car, and the white car the driver tapped.
 */
import type { CarColour } from "./carColour";
import { chromaOf } from "./carColour";
import {
  defaultPicks,
  fieldWindowsFor,
  foldReasonFor,
  hintFor,
  movesWithFor,
  orderFlags,
  settleLineShape,
  enoughHits,
  foldReasons,
  type CarOption,
} from "./identify";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// RGB triples chosen to land on the measured chroma (r/sum, b/sum) with sum 300.
const PINK_AT_START = { r: 146, g: 62, b: 92 }; // 0.487 / 0.307
const PINK_AT_CORNER = { r: 123, g: 87, b: 90 }; // 0.41 / 0.30 — the same car, 0.08 away
const RED = { r: 132, g: 90, b: 78 }; // 0.44 / 0.26 — Sandy, 0.066 away
const WHITE = { r: 105, g: 102, b: 93 }; // 0.35 / 0.31 — 0.138 away

/** The start-line reference: four clean laps, scatter 0.003, rivals seen at ~0.144. */
function ref(samples: number, separation: number | null): CarColour {
  return { chroma: chromaOf(PINK_AT_START), samples, spread: 0.003, separation };
}
const RIVALS_SEEN = 0.144 / (0.025 / 3); // separation is rivals' distance in units of scatter floor

// Measured against grey rivals: the white car is called, the pink and red ones are left alone.
{
  const measured = ref(4, RIVALS_SEEN);
  assert(hintFor(measured, WHITE) === "other", "a white car is a different colour");
  assert(hintFor(measured, PINK_AT_CORNER) === undefined, "our own car at a corner is not called different");
  assert(hintFor(measured, RED) === undefined, "red cannot be told from pink off the start line");
  assert(hintFor(measured, PINK_AT_START) === "yours", "the reference colour itself looks like ours");
}

// Rivals seen at the start line were themselves close to us (red beside pink): the rule must not
// then call our own corner crossing a different car — the floor holds it back.
{
  const closeRivals = ref(4, 0.07 / (0.025 / 3));
  assert(hintFor(closeRivals, PINK_AT_CORNER) === undefined, "the 0.10 floor protects our own car");
  assert(hintFor(closeRivals, WHITE) === "other", "white is still white");
}

// The car was alone at the start line every lap: nothing is known about how far "different" is
// on this footage, so nothing is said.
{
  const alone = ref(4, null);
  assert(hintFor(alone, WHITE) === undefined, "no rivals measured, no hint");
  assert(hintFor(alone, PINK_AT_START) === undefined, "not even 'yours'");
}

// Too few crossings to have learnt anything, or no colour on the picture: silence.
{
  assert(hintFor(ref(2, RIVALS_SEEN), WHITE) === undefined, "two samples cannot hint");
  assert(hintFor(null, WHITE) === undefined, "no reference, no hint");
  assert(hintFor(ref(4, RIVALS_SEEN), undefined) === undefined, "no colour, no hint");
}


// --- whose timing does a picture keep step with? ---
// Boronia, 2026-08-28: the driver tapped Sandy's car for Justin. Every mark then sat at a constant
// 0.02s against Sandy's lap starts and drifted 0.75s a lap against Justin's.
{
  const starts = (first: number, lapTimes: number[]) => {
    const out: Array<{ lapNumber: number; startSec: number }> = [];
    let t = first;
    lapTimes.forEach((lt, i) => { out.push({ lapNumber: i + 2, startSec: t }); t += lt; });
    return out;
  };
  const justin = { key: "competitor", name: "Justin", role: "competitor" as const, lapStarts: starts(73.8, [17.4, 17.5, 17.7, 17.2, 17.5]) };
  const sandy = { key: "sandy", name: "Sandy", lapStarts: starts(72.8, [16.9, 17.0, 16.8, 17.1, 16.9]) };
  const field = [justin, sandy];
  // Sandy's car reaches S1 4.9s into each of HER laps; Justin's reaches it 2.2s into his.
  const sandyS1 = sandy.lapStarts.map((l) => l.startSec + 4.9);
  const justinS1 = justin.lapStarts.map((l) => l.startSec + 2.2);
  // Identify lap = Justin's lap 4; the other windows read are his laps 3 and 5.
  const win = (i: number) => ({ fromSec: justin.lapStarts[i]!.startSec, toSec: justin.lapStarts[i]!.startSec + 17.4, crossings: [sandyS1[i]!, justinS1[i]!] });
  const others = [win(1), win(3)];
  const onSandy = movesWithFor(sandyS1[2]!, field, "competitor", others);
  assert(onSandy && !onSandy.mine && onSandy.key === "sandy" && onSandy.hits === 2, `Sandy's car must move with Sandy: ${JSON.stringify(onSandy)}`);
  const onJustin = movesWithFor(justinS1[2]!, field, "competitor", others);
  assert(onJustin && onJustin.mine && onJustin.hits === 2, `Justin's car must move with Justin: ${JSON.stringify(onJustin)}`);
  // A flicker that repeats against nobody says nothing.
  assert(movesWithFor(justin.lapStarts[2]!.startSec + 9.3, field, "competitor", others) === undefined, "nothing repeats, nothing said");
  // A car running nose to tail with Justin at a steady gap keeps step with BOTH timings when the
  // lap times happen to match — a tie that includes the asked-about driver is left to the picture.
  const twin = { key: "twin", name: "Twin", lapStarts: justin.lapStarts.map((l) => ({ ...l, startSec: l.startSec + 0.3 })) };
  const tied = movesWithFor(justinS1[2]!, [justin, twin], "competitor", others);
  assert(tied === undefined, `a tie with the asked-about driver must stay quiet: ${JSON.stringify(tied)}`);
  // No other laps read: no opinion.
  assert(movesWithFor(justinS1[2]!, field, "competitor", []) === undefined, "no windows, no opinion");
}

// --- corners come in track order, and a lap is only so long ---
// "How would I ever be crossing S1 at five or eleven seconds?" Six lines, a 17.5s lap. The sure
// anchors (one car per line that kept step every lap) are S2 at 2.2 and S5 at 11.6.
{
  const o = (offsetSec: number, sure = false) => ({ offsetSec, sure });
  const lines = [
    [o(0.67), o(5.0), o(11.0)],          // S1: 5.0 and 11.0 are after the S2 anchor
    [o(2.2, true), o(9.1)],              // S2 anchor; 9.1 is not it, but nothing rules 9.1 out either… except S5? no — 9.1 < 11.3, fine
    [o(5.0), o(12.0)],                   // S3: 12.0 is after the S5 anchor
    [],                                  // S4 — nothing seen
    [o(11.6, true), o(3.0)],             // S5 anchor; 3.0 is before S2's anchor
    [o(15.3), o(3.1), o(17.4)],          // S6: 3.1 before the anchors, 17.4 leaves no time for the line
  ];
  const out = orderFlags(lines, 17.5);
  assert(out[0]!.join() === "false,true,true", `S1: ${out[0]!.join()}`);
  assert(out[1]!.join() === "false,false", `S2: ${out[1]!.join()}`);
  assert(out[2]!.join() === "false,true", `S3: ${out[2]!.join()}`);
  assert(out[4]!.join() === "false,true", `S5: ${out[4]!.join()}`);
  assert(out[5]!.join() === "false,true,true", `S6: ${out[5]!.join()}`);
}
// Two sure cars on one line is a car nose to tail, not an anchor; anchors that contradict each
// other are all dropped and only the lap bounds remain.
{
  const o = (offsetSec: number, sure = false) => ({ offsetSec, sure });
  const twoSure = orderFlags([[o(7.87, true), o(8.26, true)], [o(6.61, true)], [o(3.9), o(8.36), o(9.29)]], 17.5);
  assert(twoSure[0]!.join() === "true,true", "two sure cars on one line anchor nothing — and the S3 anchor puts both after it");
  assert(twoSure[2]!.join() === "true,false,false", "S1 at 3.9 is before the S3 anchor; 8.36 and 9.29 stand");
  const contradict = orderFlags([[o(7.87, true)], [o(6.61, true)], [o(3.9), o(8.36)]], 17.5);
  assert(contradict[2]!.join() === "false,false", "contradicting anchors are ignored: only the lap bounds apply");
  assert(orderFlags([[o(17.4)]], 17.5)[0]![0] === true, "no time left to reach the line");
}
// Default picks: only the one car per line that kept step every lap.
{
  const mk = (offsetSec: number, extra: Partial<CarOption> = {}): CarOption => ({ t: 100 + offsetSec, offsetSec, quality: 8, ...extra });
  const lines = [
    { lineKey: "s1", label: "S1", options: [mk(0.7)] },
    { lineKey: "s2", label: "S2", options: [mk(2.2, { movesWith: { key: "me", name: "you", mine: true, hits: 2, of: 2 } }), mk(2.6)] },
    { lineKey: "s3", label: "S3", options: [mk(5.0), mk(5.4)] },
    { lineKey: "s4", label: "S4", options: [mk(9.0, { outOfOrder: true }), mk(9.4, { offLine: true })] },
  ];
  const picks = defaultPicks(lines);
  assert(picks.s1 === undefined, "the only car on a line is not evidence — no pick — without a field window");
  const windowed = defaultPicks([{ lineKey: "s1", label: "S1", options: [mk(0.7), mk(5.0, { offField: true })], field: { fromSec: 0, toSec: 1.7, cars: 4, centres: [0.6, 0.7, 0.8] } }]);
  assert(windowed.s1?.offsetSec === 0.7, "the one car left inside the field's window is the corner");
  const two = defaultPicks([{ lineKey: "s1", label: "S1", options: [mk(0.7), mk(1.1)], field: { fromSec: 0, toSec: 1.7, cars: 4, centres: [0.6, 0.7, 0.8] } }]);
  assert(two.s1 === undefined, "two inside the window: the driver decides");
  assert(picks.s2?.offsetSec === 2.2, "the only car that kept step every lap is picked");
  assert(picks.s3 === undefined, "two cars neither of which stands out: the driver decides");
  assert(picks.s4 === undefined, "a line whose every car is folded is not picked from");
}

// Where the field crosses each line. Three drivers on 16.9–18s laps all meet S1 seven tenths into
// their lap and S2 five seconds in. Under the same S1 pixels, on a fisheye, runs another piece of
// track that every driver reaches at 15.0s — a second cluster with real drivers behind it. A stray
// blob eleven seconds into one window repeats against nobody, and Tim is followed faithfully at
// 9.3s — nowhere near anyone else, one driver alone.
{
  const starts = (first: number, lapSec: number) =>
    [0, 1, 2].map((n) => ({ lapNumber: n + 1, startSec: first + n * lapSec }));
  const me = { key: "me", name: "you", lapStarts: starts(100, 17.5) };
  const justin = { key: "justin", name: "Justin", lapStarts: starts(101, 18) };
  // Not 17.5 like ours: a rival on exactly our lap time keeps step with our timing too, and is
  // one car with us as far as repetition can tell.
  const sandy = { key: "sandy", name: "Sandy", lapStarts: starts(103, 16.9) };
  const tim = { key: "tim", name: "Tim", lapStarts: starts(105, 17.7) };
  const field = [me, justin, sandy, tim];
  const win = (i: number) => ({ fromSec: 100.05 + i * 17.5, toSec: 117.45 + i * 17.5 });
  const at = (d: { lapStarts: Array<{ startSec: number }> }, offset: number) => d.lapStarts.map((s) => s.startSec + offset);
  const inWin = (i: number, ts: number[]) => ts.filter((t) => t >= win(i).fromSec && t <= win(i).toSec);
  const lineOf = (perDriver: number[][], extra: number[][] = [[], [], []]) =>
    [0, 1, 2].map((i) => ({ ...win(i), crossings: [...inWin(i, perDriver.flat()), ...extra[i]!] }));
  const s1 = lineOf([at(me, 0.7), at(justin, 0.7), at(sandy, 0.7), at(tim, 9.3), at(me, 15.0), at(sandy, 15.0)], [[111], [], []]);
  const s2 = lineOf([at(me, 5.0), at(justin, 5.0), at(sandy, 5.0)]);
  const [w1, w2] = fieldWindowsFor([s1, s2], field, 17.5);
  assert(w1 != null && w1.cars === 3, `S1 comes from the three drivers who agree: ${JSON.stringify(w1)}`);
  assert(w1.dir === undefined, "no directions read, no direction said");
  const withDirs = s1.map((w) => ({ ...w, dirs: w.crossings.map(() => 1 as const) }));
  const [d1] = fieldWindowsFor([withDirs, s2], field, 17.5);
  assert(d1?.dir === 1, `the field crosses S1 going +: ${JSON.stringify(d1)}`);
  const split = s1.map((w) => ({ ...w, dirs: w.crossings.map((_, k) => (k % 2 ? 1 : -1) as 1 | -1) }));
  const [u1] = fieldWindowsFor([split, s2], field, 17.5);
  assert(u1?.dir === undefined, "half each way is no direction");
  assert(w1.fromSec <= 0.7 && w1.toSec >= 0.7, "everybody's 0.7 is inside");
  assert(w1.toSec < 3, `the slack is a car's worth, not a sector's (${w1.toSec})`);
  assert(w1.toSec < 9.3, `Tim alone is no cluster (${w1.toSec})`);
  assert(w2 != null && w2.fromSec <= 5.0 && w2.toSec >= 5.0 && w2.toSec < 7.5, `S2 is around five seconds: ${JSON.stringify(w2)}`);
  // S1 alone, without S2 to order it against: the fifteen-second cluster (two drivers) loses to
  // the three-driver one on numbers — and with only S1 read, the lap bound still holds it.
  const [alone] = fieldWindowsFor([s1], field, 17.5);
  assert(alone != null && alone.toSec < 3, `more drivers win when order cannot decide: ${JSON.stringify(alone)}`);
  // Order decides when numbers cannot: give the far cluster three drivers too, and it is S2 at
  // five seconds that rules it out — S1 cannot come at fifteen when S2 comes at five.
  const s1far = lineOf([at(me, 0.7), at(justin, 0.7), at(sandy, 0.7), at(me, 15.0), at(sandy, 15.0), at(justin, 15.0)]);
  const [o1, o2] = fieldWindowsFor([s1far, s2], field, 17.5);
  assert(o1 != null && o1.toSec < 3 && o2 != null, `track order picks the early cluster: ${JSON.stringify([o1, o2])}`);
  // Too few to say: one driver, or one window.
  assert(fieldWindowsFor([lineOf([at(me, 0.7)])], [me], 17.5)[0] === null, "one driver says nothing");
  assert(fieldWindowsFor([[s1[0]!]], field, 17.5)[0] === null, "one window has nothing to repeat against");
  // A twin on exactly our lap time, three tenths behind, fits every crossing of ours too. It joins
  // the same cluster (its offsets sit three tenths from ours) and changes nothing.
  const twin = { key: "twin", name: "Twin", lapStarts: starts(100.3, 17.5) };
  const [t1] = fieldWindowsFor([s1, s2], [...field, twin], 17.5);
  assert(t1 != null && t1.toSec < 3 && t1.fromSec <= 0.4, `a twin widens the cluster by its gap, no more: ${JSON.stringify(t1)}`);
}
// Folds: beside the line folds, unless that car kept step with the driver every lap; outside
// the field's window folds; and a kept-step car beside the line is still picked.
{
  const mk = (offsetSec: number, extra: Partial<CarOption> = {}): CarOption => ({ t: 100 + offsetSec, offsetSec, quality: 8, ...extra });
  const mine = { key: "me", name: "you", mine: true, hits: 2, of: 2 };
  assert(foldReasonFor(mk(9.4, { offLine: true })) === "off-line", "beside the line is not across it");
  assert(foldReasonFor(mk(9.4, { offLine: true, movesWith: mine })) === "off-line", "kept step alone does not excuse it — settleLineShape decides whether the line is short");
  assert(foldReasonFor(mk(9.4, { offLine: true, movesWith: mine, shortLine: true })) === undefined, "a short line's own car stays");
  assert(foldReasonFor(mk(11, { offField: true })) === "field", "outside where the field crosses");
  assert(foldReasonFor(mk(11, { offField: true, outOfOrder: true })) === "order", "order is said first");
  assert(foldReasonFor(mk(7.8, { wrongWay: true })) === "direction", "crossing the other way to the field folds");
  assert(foldReasonFor(mk(10.8, { offField: true, movesWith: mine })) === "field", "kept step outside the window is your car, not this corner");
  assert(foldReasons(mk(10.4, { offField: true, movesWith: { ...mine, mine: false, name: "Sandy" } })).length === 2, "ruled out twice over");
  const picks = defaultPicks([{ lineKey: "s4", label: "S4", options: [mk(9.0, { offLine: true }), mk(9.4, { offLine: true, movesWith: mine, shortLine: true })] }]);
  assert(picks.s4?.offsetSec === 9.4, "the kept-step car beside a short line is picked");
}

// The line's shape, settled last. "For sector four it got it wrong. It said 'on 2 of 2 your
// laps'… it was on a 180 hairpin, on the way coming back, past where the sector should be."
{
  const mk = (offsetSec: number, extra: Partial<CarOption> = {}): CarOption => ({ t: 100 + offsetSec, offsetSec, quality: 8, ...extra });
  const mine = { key: "me", name: "you", mine: true, hits: 2, of: 2 };
  // His car on the line going in, and beside it (past the end) coming back: the return pass
  // folds, the real one is picked, no "lengthen the line" nudge.
  const back = settleLineShape([mk(7.9, { movesWith: mine, dir: 1 }), mk(8.3, { movesWith: mine, dir: -1, offLine: true }), mk(11.7)]);
  assert(foldReasonFor(back[1]!) === "off-line", "the return pass beside the line folds");
  assert(!back[1]!.shortLine && !back[0]!.shortLine, "a car on the line kept step: the line is not short");
  assert(defaultPicks([{ lineKey: "s4", label: "S4", options: back }]).s4?.offsetSec === 7.9, "the pass on the line is picked");
  // Nothing on the line kept step — only the car beside it. The line is short: shown, not picked
  // against, and the screen says to lengthen it.
  const short = settleLineShape([mk(7.9, { movesWith: mine, dir: 1, offLine: true }), mk(11.7)]);
  assert(short[0]!.shortLine === true && foldReasonFor(short[0]!) === undefined, "a short line's own car stays");
  assert(defaultPicks([{ lineKey: "s4", label: "S4", options: short }]).s4?.offsetSec === 7.9, "and is still picked");
  // Both passes on the line, opposite ways, a moment apart: a hairpin. Neither is picked.
  const pin = settleLineShape([mk(7.9, { movesWith: mine, dir: 1 }), mk(8.3, { movesWith: mine, dir: -1 })]);
  assert(pin[0]!.hairpin === true && pin[1]!.hairpin === true, "two passes on the line are a hairpin");
  assert(foldReasonFor(pin[0]!) === undefined && foldReasonFor(pin[1]!) === undefined, "neither folds");
  assert(defaultPicks([{ lineKey: "s4", label: "S4", options: pin }]).s4 === undefined, "a hairpin is the driver's to tap");
  // Same direction, or too far apart, or no direction known: not a hairpin (two sure cars on a
  // line already means no pick — the twin case).
  const same = settleLineShape([mk(7.9, { movesWith: mine, dir: 1 }), mk(8.3, { movesWith: mine, dir: 1 })]);
  assert(!same[0]!.hairpin && !same[1]!.hairpin, "same way twice is not a hairpin");
  const far = settleLineShape([mk(2.0, { movesWith: mine, dir: 1 }), mk(8.3, { movesWith: mine, dir: -1 })]);
  assert(!far[0]!.hairpin && !far[1]!.hairpin, "six seconds apart is not a hairpin");
  const blind = settleLineShape([mk(7.9, { movesWith: mine }), mk(8.3, { movesWith: mine })]);
  assert(!blind[0]!.hairpin && !blind[1]!.hairpin, "no direction, no hairpin call");
  // A rival's car is never part of it.
  const rival = settleLineShape([mk(7.9, { movesWith: mine, dir: 1 }), mk(8.3, { movesWith: { ...mine, mine: false, name: "Tim" }, dir: -1 })]);
  assert(!rival[0]!.hairpin, "a rival going the other way is not our hairpin");
}

// Nearly every lap is every lap: one miss in four is allowed, one in two is not.
{
  assert(enoughHits(2, 2) && !enoughHits(1, 2), "two of two, not one of two");
  assert(enoughHits(3, 4) && !enoughHits(2, 4), "three of four, not two of four");
  assert(enoughHits(3, 3) && !enoughHits(2, 3), "three of three, not two of three");
  assert(!enoughHits(0, 0), "nothing read, nothing kept");
}

console.log("findCrossings identify.test.ts OK");
