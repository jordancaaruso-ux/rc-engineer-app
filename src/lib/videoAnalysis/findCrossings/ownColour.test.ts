/**
 * A line's own colour reference, and what it may do — the Bendigo 4K practice of 2026-09-09,
 * Jordan's S3, in the scan's own numbers.
 *
 * On S3 the pink car reads rf 0.451 bf 0.317 on every lap it crossed alone (scatter 0.002). On
 * laps 2 and 6 the window also held a grey-blue flicker at the line's kerb end (rf 0.303 bf
 * 0.358) a third of a second BEFORE the car, nearer the prediction, and it was picked. On lap 5
 * the same flicker was the only candidate. The sector clips opened with the car nowhere near
 * the line.
 */
import {
  farBar,
  learnOwnColours,
  lineColourVerdict,
  ownColourKey,
  repickByColour,
  MIN_COLOURFUL,
  MIN_LINE_SAMPLES,
  type ColourRow,
} from "./ownColour";
import { chromaDistance, chromaOf, type Rgb } from "./carColour";
import type { CrossingEvent } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SF = "sf";
const roleOf = (id: string) => id.split(":")[0]!;

/** An RGB with the given chroma fractions, at a brightness that keeps the numbers whole. */
function rgb(rf: number, bf: number, sum = 420): Rgb {
  return { r: rf * sum, g: (1 - rf - bf) * sum, b: bf * sum };
}
const PINK = rgb(0.451, 0.317);
const PINK_LIT = rgb(0.449, 0.319, 470);
const PINK_SHADE = rgb(0.453, 0.316, 380);
const KERB_GREY_BLUE = rgb(0.303, 0.358, 510);
const KERB_RED_BROWN = rgb(0.413, 0.254, 435);
const TARMAC = rgb(0.339, 0.325, 444);

function cand(t: number, colour: Rgb, extra: Partial<CrossingEvent> = {}): CrossingEvent {
  return { t, quality: 7, x: 2800, y: 1180, dir: 1, source: "confirmed", colour, ...extra };
}

function row(
  role: string,
  lap: number,
  lineKey: string,
  detectedSec: number | null,
  candidates: CrossingEvent[],
  extra: Partial<ColourRow> = {}
): ColourRow {
  return {
    id: `${role}:${lap}:${lineKey}`,
    lineKey,
    lapNumber: lap,
    centerSec: detectedSec ?? candidates[0]?.t ?? 0,
    detectedSec,
    quality: 7,
    candidates,
    source: "confirmed",
    ...extra,
  } as ColourRow;
}

// The laps where the car was alone at S3 — what the reference is learnt from.
const alone = [
  row("me", 3, "s3", 1327.72, [cand(1327.72, PINK)]),
  row("me", 7, "s3", 1388.55, [cand(1388.55, PINK_LIT)]),
  row("me", 8, "s3", 1404.01, [cand(1404.01, PINK_SHADE)]),
  row("me", 9, "s3", 1419.10, [cand(1419.10, PINK)]),
];

/* ---------- learning: alone, confirmed, three laps, a real colour ---------- */
{
  const own = learnOwnColours(alone, SF, roleOf);
  const line = own.get(ownColourKey("me", "s3"));
  assert(line, "four laps alone at S3 teach S3's colour");
  assert(line.ref.samples === 4, `all four taught, got ${line.ref.samples}`);
  assert(Math.abs(line.ref.chroma.rf - 0.451) < 0.003 && Math.abs(line.ref.chroma.bf - 0.317) < 0.003, "the reference is the pink car");
  assert(line.ref.spread < 0.005, `the same car scatters little, got ${line.ref.spread}`);
  assert(line.colourful > MIN_COLOURFUL, "pink is a colour");
  assert(farBar(line.ref) === 0.1, `with a tight reference the far bar is the floor, got ${farBar(line.ref)}`);

  // Two laps are not enough; nor is a lap with company; nor a rescued or untracked pick.
  const two = learnOwnColours(alone.slice(0, MIN_LINE_SAMPLES - 1), SF, roleOf);
  assert(!two.has(ownColourKey("me", "s3")), "two laps alone teach nothing");
  const company = learnOwnColours(
    [...alone.slice(0, 2), row("me", 9, "s3", 1419.10, [cand(1418.80, KERB_GREY_BLUE), cand(1419.10, PINK)])],
    SF,
    roleOf
  );
  assert(!company.has(ownColourKey("me", "s3")), "a lap with something else in the window does not teach");
  const untracked = learnOwnColours(
    [...alone.slice(0, 2), row("me", 9, "s3", 1419.10, [cand(1419.10, PINK, { source: "unconfirmed" })], { source: "unconfirmed" })],
    SF,
    roleOf
  );
  assert(!untracked.has(ownColourKey("me", "s3")), "an untracked flicker does not teach");

  // The start line never teaches here, and neither does the tarmac.
  const sf = learnOwnColours(alone.map((r) => ({ ...r, lineKey: SF })), SF, roleOf);
  assert(sf.size === 0, "the start line is the transponder's, not this module's");
  const grey = learnOwnColours(alone.map((r) => ({ ...r, candidates: [cand(r.detectedSec!, TARMAC)] })), SF, roleOf);
  assert(grey.size === 0, "a grey reference is the tarmac talking and may refuse nothing");

  // "Alone" is judged on everything the window saw, when the caller has more than the row kept.
  const everything = new Map<string, CrossingEvent[]>([["me:3:s3", [cand(1327.40, KERB_GREY_BLUE, { dir: -1 }), cand(1327.72, PINK)]]]);
  const seenAll = learnOwnColours(alone, SF, roleOf, (r) => everything.get(r.id) ?? r.candidates);
  assert(seenAll.get(ownColourKey("me", "s3"))?.ref.samples === 3, "lap 3 had company the other way and does not teach");
}

/* ---------- what the reference says about a picture ---------- */
{
  const line = learnOwnColours(alone, SF, roleOf).get(ownColourKey("me", "s3"));
  assert(line, "reference");
  assert(lineColourVerdict(line, PINK_LIT) === "yours", "the car in more light is still the car");
  assert(lineColourVerdict(line, KERB_GREY_BLUE) === "other", "the kerb's grey-blue is not the car");
  assert(chromaDistance(line.ref.chroma, chromaOf(KERB_RED_BROWN)) > 0.03 && chromaDistance(line.ref.chroma, chromaOf(KERB_RED_BROWN)) < 0.1, "test data: the red-brown kerb sits in the band between");
  assert(lineColourVerdict(line, KERB_RED_BROWN) === undefined, "the band between says nothing");
  assert(lineColourVerdict(undefined, PINK) === undefined && lineColourVerdict(line, undefined) === undefined, "nothing known, nothing said");
}

/* ---------- the review: swap when the car was on offer, hold when it was not ---------- */
{
  const lap2 = row("me", 2, "s3", 1312.57, [
    cand(1312.04, KERB_RED_BROWN),
    cand(1312.52, KERB_GREY_BLUE, { dir: -1 }),
    cand(1312.57, KERB_GREY_BLUE),
    cand(1312.86, PINK, { quality: 8 }),
    cand(1314.51, KERB_RED_BROWN),
  ], { centerSec: 1312.6 });
  const lap5 = row("me", 5, "s3", 1358.77, [cand(1358.77, KERB_GREY_BLUE, { quality: 10 })]);
  const lap10 = row("me", 10, "s3", 1433.95, [cand(1432.68, TARMAC), cand(1433.95, PINK), cand(1434.33, KERB_RED_BROWN)]);
  const other = row("me", 2, "s4", 1316.10, [cand(1316.10, KERB_GREY_BLUE)]);
  const rows = [...alone, lap2, lap5, lap10, other];
  const own = learnOwnColours(rows, SF, roleOf);
  const out = repickByColour(rows, own, SF, roleOf);

  const two = out.rows.find((r) => r.id === "me:2:s3")!;
  assert(two.detectedSec === 1312.86, `lap 2 moves onto the pink car, got ${two.detectedSec}`);
  assert(two.quality === 8 && two.source === "confirmed", "the swap carries the candidate's own quality and source");
  assert(two.colourSwap?.fromSec === 1312.57 && two.colourSwap.distance > 0.1, "and says where it came from");
  assert(out.swapped.length === 1 && out.swapped[0] === "me:2:s3", "one swap");

  const five = out.rows.find((r) => r.id === "me:5:s3")!;
  assert(five.detectedSec === 1358.77 && five.colourHold != null, "lap 5 keeps its time but is held: nothing pink was on offer");
  assert(out.held.length === 1 && out.held[0] === "me:5:s3", "one hold");

  const ten = out.rows.find((r) => r.id === "me:10:s3")!;
  assert(ten.detectedSec === 1433.95 && !ten.colourSwap && !ten.colourHold, "a pink pick is left alone, whatever else is in the window");
  const s4 = out.rows.find((r) => r.id === "me:2:s4")!;
  assert(!s4.colourHold && !s4.colourSwap, "a line with no reference stays colour-blind");
  for (const r of alone) {
    const same = out.rows.find((o) => o.id === r.id)!;
    assert(same.detectedSec === r.detectedSec && !same.colourSwap && !same.colourHold, "the laps that taught the colour are untouched");
  }

  // Fixed rows — hand marks, lap starts — are never touched, even when the colour disagrees.
  const fixed = repickByColour(rows, own, SF, roleOf, new Set(["me:2:s3", "me:5:s3"]));
  assert(fixed.swapped.length === 0 && fixed.held.length === 0, "a mark somebody placed outranks the colour");

  // With two matching candidates, the one nearer the prediction wins.
  const twice = row("me", 12, "s3", 1462.20, [cand(1462.20, KERB_GREY_BLUE), cand(1462.55, PINK, { quality: 5 }), cand(1463.90, PINK_LIT, { quality: 9 })], { centerSec: 1462.5 });
  const near = repickByColour([...alone, twice], own, SF, roleOf).rows.find((r) => r.id === "me:12:s3")!;
  assert(near.detectedSec === 1462.55, `nearest the prediction, not the best-supported, got ${near.detectedSec}`);

  // The band between: a red-brown kerb flicker is not the car, but not far enough to refuse on
  // its own. With the car itself a fifth of a second away it is a tiebreak and the car wins;
  // with nothing pink near it, the pick stands — never held.
  const kerbD = chromaDistance(own.get(ownColourKey("me", "s3"))!.ref.chroma, chromaOf(KERB_RED_BROWN));
  assert(kerbD > 2 * 0.025 && kerbD < 0.1, `test data: the red-brown kerb sits in the band, d ${kerbD}`);
  const lap14 = row("me", 14, "s3", 1588.04, [cand(1587.23, KERB_RED_BROWN), cand(1587.82, PINK, { quality: 7 }), cand(1588.04, KERB_RED_BROWN, { quality: 6 })], { centerSec: 1588.0 });
  const tie = repickByColour([...alone, lap14], own, SF, roleOf);
  assert(tie.rows.find((r) => r.id === "me:14:s3")!.detectedSec === 1587.82 && tie.swapped.includes("me:14:s3"), "lap 14 moves onto the pink car a fifth of a second earlier");
  const lonely = row("me", 15, "s3", 1603.30, [cand(1602.40, PINK), cand(1603.30, KERB_RED_BROWN)], { centerSec: 1603.2 });
  const stands = repickByColour([...alone, lonely], own, SF, roleOf);
  const kept = stands.rows.find((r) => r.id === "me:15:s3")!;
  assert(kept.detectedSec === 1603.30 && !kept.colourSwap && !kept.colourHold && stands.held.length === 0, "a pink candidate nearly a second away is another lap of the car, not a tiebreak — the pick stands");
}

console.log("ownColour.test.ts: ok");
