/**
 * The three checks that need no reference data: a lap has to be a whole lap, one car cannot be in
 * two places at once, and the corners come in the order they sit on the track.
 *
 * Every case here is taken from the Boronia race of 2026-08-26, where all three fired for real.
 */
import { dropDuplicates, flagImplausible, flagOutOfOrder, type RefinableResult } from "./refine";
import { realLaps, sfAnchorTime, SF_AGREE_SEC } from "./fromSession";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SF = "sf";
const lapKey = (r: RefinableResult) => r.id.split(":").slice(0, 2).join(":");
const roleLine = (r: RefinableResult) => `${r.id.split(":")[0]}:${r.lineKey}`;

function at(
  role: string,
  lapNumber: number,
  lineKey: string,
  detectedSec: number,
  extra: Partial<RefinableResult> = {}
): RefinableResult {
  return {
    id: `${role}:${lapNumber}:${lineKey}`,
    lineKey,
    lapNumber,
    centerSec: detectedSec,
    detectedSec,
    quality: null,
    candidates: [],
    source: "unconfirmed",
    ...extra,
  };
}

/* ---------- a race's opening lap is not a lap ---------- */
{
  // Real figures: the transponder times a race's first lap from the start line, not from
  // start/finish, so it comes back as a fragment against a 17-second median.
  const laps = [
    { lapNumber: 1, lapTimeSec: 1.386 },
    { lapNumber: 2, lapTimeSec: 17.9 },
    { lapNumber: 3, lapTimeSec: 17.4 },
    { lapNumber: 4, lapTimeSec: 17.6 },
    { lapNumber: 5, lapTimeSec: 18.2 },
  ];
  const kept = realLaps(laps).map((l) => l.lapNumber);
  assert(!kept.includes(1), "the opening fragment must not count as a lap");
  assert(kept.length === 4, `expected 4 real laps, got ${kept.length}`);

  // A genuinely quick lap is never dropped — the whole point is that no driver is 40% faster
  // than their own median.
  const quick = realLaps([...laps.slice(1), { lapNumber: 6, lapTimeSec: 16.2 }]);
  assert(quick.some((l) => l.lapNumber === 6), "a fast lap must survive");

  // Too few laps to know what normal is: keep everything rather than guess.
  assert(realLaps([{ lapNumber: 1, lapTimeSec: 0.9 }]).length === 1, "no median, no filtering");
  assert(
    realLaps([{ lapNumber: 1, lapTimeSec: 17, isIncluded: false }]).length === 0,
    "an excluded lap is still excluded"
  );
}

/* ---------- two laps cannot share a crossing ---------- */
{
  const results = [
    at("competitor", 1, "s1", 82.786),
    at("competitor", 2, "s1", 82.786), // the same crossing, claimed twice
    at("competitor", 3, "s1", 100.537),
    at("me", 1, "s1", 82.786), // a different driver at the same instant is NOT a duplicate
  ];
  const dropped = dropDuplicates(results, roleLine, 1.0);
  assert(dropped.size === 1, `expected one drop, got ${[...dropped].join(", ")}`);
  assert(!dropped.has("me:1:s1"), "two cars crossing together must both survive");
  assert(!dropped.has("competitor:3:s1"), "a real second lap must survive");

  // Better evidence wins the tie.
  const ranked = dropDuplicates(
    [
      at("me", 1, "s2", 50.0, { source: "confirmed" }),
      at("me", 2, "s2", 50.2, { source: "unconfirmed" }),
    ],
    roleLine,
    1.0
  );
  assert(ranked.has("me:2:s2") && ranked.size === 1, "the weaker detection loses");

  // Level evidence: the one that landed nearest what it was looking for stays.
  const byAim = dropDuplicates(
    [
      at("me", 1, "s3", 50.0, { centerSec: 50.9 }),
      at("me", 2, "s3", 50.2, { centerSec: 50.25 }),
    ],
    roleLine,
    1.0
  );
  assert(byAim.has("me:1:s3") && byAim.size === 1, "the wilder miss loses");

  // A lap apart is a lap apart.
  assert(
    dropDuplicates([at("me", 1, "s1", 50), at("me", 2, "s1", 67.5)], roleLine, 1.0).size === 0,
    "consecutive laps are not duplicates"
  );
}

/* ---------- the corners come in track order ---------- */
{
  // Four clean laps set what each corner's sector time normally is, then lap 7 puts S3 late
  // enough to land after S4 — which no car can do.
  const results: RefinableResult[] = [];
  for (const [lap, start] of [[3, 100], [4, 118], [5, 136], [6, 154]] as const) {
    results.push(at("me", lap, SF, start, { source: "confirmed" }));
    results.push(at("me", lap, "s1", start + 2.0));
    results.push(at("me", lap, "s2", start + 4.5));
    results.push(at("me", lap, "s3", start + 7.0));
    results.push(at("me", lap, "s4", start + 10.0));
  }
  results.push(at("me", 7, SF, 172, { source: "confirmed" }));
  results.push(at("me", 7, "s1", 174.0));
  results.push(at("me", 7, "s2", 176.5));
  results.push(at("me", 7, "s3", 182.4)); // 10.4s in — after S4, and 3.4s off its own usual
  results.push(at("me", 7, "s4", 182.0));

  const odd = flagOutOfOrder(results, SF, lapKey);
  assert(odd.has("me:7:s3"), "the corner that broke the order must be held back");
  assert(!odd.has("me:7:s4"), "the corner sitting where it always sits must be kept");
  assert(odd.size === 1, `expected one flag, got ${[...odd].join(", ")}`);

  // Nothing inverted, nothing flagged.
  const clean = flagOutOfOrder(results.filter((r) => r.lapNumber !== 7), SF, lapKey);
  assert(clean.size === 0, `clean laps must not be flagged, got ${[...clean].join(", ")}`);
}

/* ---------- a line half-full of somebody else's car ---------- */
{
  // Straight from the Boronia proxy scan: S3 on ten laps, the car at ~6.38s after each lap start
  // on five of them, and a rival on the other five — 1.1s early on two laps, 1.8s early on one,
  // 0.4–0.5s late on two. The median-and-spread rule flagged NONE of these; the spread grew to
  // cover them. The biggest agreeing cluster is still the five real ones.
  const starts = [100, 118, 136, 154, 172, 190, 208, 226, 244, 262];
  const offsets = [6.38, 6.41, 6.35, 6.40, 6.36, 5.29, 5.29, 4.57, 6.75, 6.88];
  const results: RefinableResult[] = [];
  starts.forEach((start, i) => {
    results.push(at("me", i + 1, SF, start, { source: "confirmed" }));
    results.push(at("me", i + 1, "s3", start + offsets[i]!));
  });
  const odd = flagImplausible(results, SF, lapKey);
  const flaggedLaps = [...odd].map((id) => Number(id.split(":")[1])).sort((x, y) => x - y);
  assert(
    JSON.stringify(flaggedLaps) === JSON.stringify([6, 7, 8, 9, 10]),
    `expected laps 6-10 held back, got ${flaggedLaps.join(",")}`
  );

  // Too few laps to know what agreement looks like: nothing is flagged, nothing is guessed.
  const few = flagImplausible(results.filter((r) => r.lapNumber <= 3), SF, lapKey);
  assert(few.size === 0, "three laps cannot convict anything");
}

/* ---------- a slow lap is not a wrong lap ---------- */
{
  // Six laps of 18s with S3 at 7.9s and S4 at 11.8s after the lap start. On lap 5 the driver
  // loses three tenths before S3 in traffic and another tenth by S4 — the shape of Boronia lap
  // 12 (+0.27 at S3, +0.39 at S5). By lap-start offset S3 is inside the tolerance and S4 is
  // outside it (0.4 > 0.35), so the offset rule alone holds S4 back; measured from S3 the gap is
  // a tenth off its usual, so it is kept. A rival's S4, over a second early, fails both ways.
  const results: RefinableResult[] = [];
  for (let lap = 1; lap <= 6; lap++) {
    const start = 100 + (lap - 1) * 18;
    const lateS3 = lap === 5 ? 0.3 : 0;
    const lateS4 = lap === 5 ? 0.4 : 0;
    results.push(at("me", lap, SF, start, { source: "confirmed" }));
    results.push(at("me", lap, "s3", start + 7.9 + lateS3));
    results.push(at("me", lap, "s4", start + 11.8 + lateS4));
  }
  const odd = flagImplausible(results, SF, lapKey);
  assert(!odd.has("me:5:s4"), "a corner at its usual gap from the previous corner is kept on a slow lap");
  assert(!odd.has("me:5:s3"), "a slow first corner is inside the offset tolerance anyway");

  const rival = results.map((r) => (r.id === "me:5:s4" ? { ...r, detectedSec: r.detectedSec! - 1.4 } : r));
  const still = flagImplausible(rival, SF, lapKey);
  assert(still.has("me:5:s4"), "a crossing off by both offset and gap stays held back");

  // A rival's chain cannot vouch for itself: if S3 on that lap is ALSO the rival's (0.9s early),
  // the gap from it to the rival's S4 looks normal — but S3 is untrusted, so the lap start is the
  // reference, and against that S4 is still a second out.
  const chain = results.map((r) =>
    r.id === "me:5:s3" ? { ...r, detectedSec: r.detectedSec! - 1.3 } : r.id === "me:5:s4" ? { ...r, detectedSec: r.detectedSec! - 1.3 } : r
  );
  const both = flagImplausible(chain, SF, lapKey);
  assert(both.has("me:5:s3") && both.has("me:5:s4"), "a rival's whole chain stays held back");
}

/* ---------- a car that was never followed ---------- */
{
  // Boronia 2026-08-28, competitor role: every crossing written for Justin was Sandy's car, so
  // against Justin's own lap starts the S1 offsets ran -1.10, -1.48, -2.49, -3.69, -4.04, -4.86,
  // -5.29, -6.38 — never three within 0.35s of each other. "No cluster" used to hold nothing.
  const results: RefinableResult[] = [];
  const drift = [-1.1, -1.48, -2.49, -3.69, -4.04, -4.86, -5.29, -6.38];
  drift.forEach((off, i) => {
    const start = 100 + i * 17.5;
    results.push(at("competitor", i + 3, SF, start, { source: "confirmed" }));
    results.push(at("competitor", i + 3, "s1", start + off));
  });
  // The driver being scanned alongside is followed fine on the same line.
  for (let i = 0; i < 8; i++) {
    const start = 100.7 + i * 17.6;
    results.push(at("me", i + 3, SF, start, { source: "confirmed" }));
    results.push(at("me", i + 3, "s1", start + 0.7 + (i % 2 ? 0.05 : -0.04)));
  }
  const odd = flagImplausible(results, SF, lapKey);
  const held = [...odd].filter((id) => id.startsWith("competitor:")).length;
  assert(held === drift.length, `every unfollowed crossing must be held, got ${held} of ${drift.length}`);
  assert(![...odd].some((id) => id.startsWith("me:")), "the followed driver keeps every row");
}

// The transponder walk is the lap start; a detection only confirms it. At Boronia the
// start/finish window caught the car behind (~1.4s late) lap after lap, and it was written as
// the lap start, which is how a rival's lap became "yours".
{
  assert(sfAnchorTime(undefined, 100) === 100, "no detection: the walk");
  assert(sfAnchorTime(100.05, 100) === 100.05, "a detection a frame or two off is believed");
  assert(sfAnchorTime(100.6, 100) === 100, "a detection over half a second off is another car");
  assert(sfAnchorTime(100 - SF_AGREE_SEC, 100) === 100 - SF_AGREE_SEC, "the edge is inclusive");
}

console.log("findCrossings refine.test.ts OK");
