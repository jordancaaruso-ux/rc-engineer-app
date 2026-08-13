import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShareRunCard,
  defaultSectionsForMode,
  estimateCardHeight,
  parseSectionsParam,
  runIsShareable,
  serializeSections,
  wrappedLines,
  type ShareRunInput,
  type ShareSections,
} from "@/lib/share/shareCardModel";

/**
 * What a driver is about to publish, pinned.
 *
 * Every case here is about *what goes on the picture*, not what it looks like — the layout is
 * only ever proved by looking at a rendered card. The height assertions are the exception: they
 * exist because satori clips overflow silently, so a card that grows without its estimate
 * growing loses its own footer with no error anywhere.
 */

const LAPS = [
  15.612, 15.388, 15.201, 15.114, 15.276, 15.198, 15.34, 15.402, 15.887, 15.455,
  15.298, 15.221, 15.377, 15.509, 15.664, 15.812, 16.104, 16.398, 15.744,
];

function run(overrides: Partial<ShareRunInput> = {}): ShareRunInput {
  return {
    sessionType: "RACE_MEETING",
    meetingSessionType: "QUALIFYING",
    sessionLabel: "Q2",
    lapTimes: LAPS,
    notes: "Loose on entry once the fronts came in.",
    carRating: 7,
    tireRunNumber: 3,
    conditionsAirTempC: 24,
    conditionsTrackTempC: 31,
    conditionsWindKph: 11,
    car: { name: "Awesomatix A800RR" },
    track: { name: "Barton Park Raceway" },
    tireType: { displayName: "Volante VT-R2" },
    additiveType: { displayName: "Trinity Death Row" },
    event: { name: "Round 4" },
    ...overrides,
  };
}

function build(mode: "headline" | "full", sections?: Partial<ShareSections>, extra = {}) {
  return buildShareRunCard({
    run: run(),
    mode,
    sections: { ...defaultSectionsForMode(mode), ...sections },
    dateTimeLabel: "9 Aug 2026, 10:42",
    driverName: "Jordan Caruso",
    ...extra,
  });
}

// --------------------------------------------------------------------------
// The four figures
// --------------------------------------------------------------------------

test("headline is best, avg top 5, avg top 10, laps/time — in that order", () => {
  const card = build("headline");
  assert.deepEqual(
    card.tiles.map((t) => t.label),
    ["Best lap", "Avg top 5", "Avg top 10", "Laps / time"]
  );
  assert.equal(card.tiles[0]!.value, "15.114");
  assert.equal(card.tiles[3]!.value, "19");
});

test("headline carries a conditions line and no session-detail wells", () => {
  const card = build("headline");
  assert.match(card.conditionsLine ?? "", /Air 24°C/);
  assert.match(card.conditionsLine ?? "", /Track 31°C/);
  assert.equal(card.details.length, 0);
  assert.equal(card.lapWells.length, 0);
});

// --------------------------------------------------------------------------
// Full run mirrors the expanded session view
// --------------------------------------------------------------------------

test("full run shows the six session details and all nine lap figures", () => {
  const card = build("full");
  assert.deepEqual(
    card.details.map((d) => d.label),
    ["Date / time", "Session", "Car", "Tire set", "Additive", "Tire prep"]
  );
  assert.deepEqual(
    card.lapWells.map((w) => w.label),
    ["Laps", "Stint", "Best lap", "Avg top 5", "Avg top 10", "Median", "Cond.", "Consist.", "Mistakes"]
  );
});

test("full run brings notes, rating and every lap without being asked", () => {
  const card = build("full");
  assert.ok(card.notes, "notes travel with a full run");
  assert.equal(card.rating, 7);
  assert.ok(card.laps && card.laps.length === LAPS.length);
  assert.ok(card.bars, "the trace comes with it too");
});

test("headline brings none of them", () => {
  const card = build("headline");
  assert.equal(card.notes, null);
  assert.equal(card.rating, null);
  assert.equal(card.laps, null);
  assert.equal(card.bars, null);
});

test("a chip still overrides the mode — full run with notes off", () => {
  const card = build("full", { notes: false });
  assert.equal(card.notes, null);
  assert.equal(card.rating, null, "the rating is part of the same answer, so it goes too");
  assert.ok(card.laps, "and nothing else is disturbed");
});

// --------------------------------------------------------------------------
// Flags on laps
// --------------------------------------------------------------------------

test("the best lap is flagged and the slow ones are marked as mistakes", () => {
  const card = build("full");
  const best = card.laps!.filter((l) => l.flag === "best");
  assert.equal(best.length, 1);
  assert.equal(best[0]!.time, "15.114");
  assert.ok(
    card.laps!.some((l) => l.flag === "miss"),
    "16.398 is well off this session's median"
  );
});

// --------------------------------------------------------------------------
// Trace direction — the app plots slow at the top (LapTimeGraph's yAt), and a card
// that disagreed with the screen it came from would be worse than either convention.
// --------------------------------------------------------------------------

test("taller is SLOWER: the fastest lap gets the shortest bar", () => {
  const bars = build("full").bars!;
  const fastestIndex = LAPS.indexOf(Math.min(...LAPS));
  const slowestIndex = LAPS.indexOf(Math.max(...LAPS));

  const shortest = Math.min(...bars.map((b) => b.heightPct));
  const tallest = Math.max(...bars.map((b) => b.heightPct));

  assert.equal(bars[fastestIndex]!.heightPct, shortest, "15.114 is the shortest bar");
  assert.equal(bars[slowestIndex]!.heightPct, tallest, "16.398 is the tallest");
});

test("even the fastest lap still draws a visible bar", () => {
  const bars = build("full").bars!;
  assert.ok(Math.min(...bars.map((b) => b.heightPct)) >= 15);
});

test("an excluded lap is kept on the card but marked", () => {
  // `lapSession` carries the driver's manual exclusions in `entries[0].perLap` — see
  // `tryReadPrimaryPerLap`. Anything else is ignored and every lap counts.
  const card = buildShareRunCard({
    run: run({
      lapSession: {
        version: 1,
        entries: [{ perLap: LAPS.map((_, i) => ({ isIncluded: i !== 2 })) }],
      },
    }),
    mode: "full",
    sections: defaultSectionsForMode("full"),
    dateTimeLabel: "9 Aug 2026, 10:42",
  });
  const excluded = card.laps!.filter((l) => l.excluded);
  assert.equal(excluded.length, 1, "a struck-through lap is still part of the record");
});

// --------------------------------------------------------------------------
// Pace vs field — the sign convention is the whole point
// --------------------------------------------------------------------------

test("faster than the field reads as a negative number", () => {
  const card = build("headline", { pace: true }, { paceVsFieldSeconds: -0.184 });
  assert.equal(card.pace?.value, "−0.184");
  assert.equal(card.pace?.faster, true);
  assert.match(card.pace!.note, /faster/);
});

test("slower than the field reads as a positive one", () => {
  const card = build("headline", { pace: true }, { paceVsFieldSeconds: 0.211 });
  assert.equal(card.pace?.value, "+0.211");
  assert.equal(card.pace?.faster, false);
});

test("no field comparison means no fifth tile, even with the chip on", () => {
  const card = build("headline", { pace: true }, { paceVsFieldSeconds: null });
  assert.equal(card.pace, null);
});

// --------------------------------------------------------------------------
// Setup diff
// --------------------------------------------------------------------------

test("setup diff is what changed since the previous run, old value first", () => {
  const card = build(
    "full",
    {},
    {
      setupData: { camber_front: "-1.5", ride_height_rear: "5.5" },
      previousSetupData: { camber_front: "-1.5", ride_height_rear: "5.0" },
    }
  );
  assert.equal(card.changed?.length, 1);
  // Values arrive already normalised by `compareSetupField` — "5.0" and "5" are the same number
  // and the compare layer says so, which is why the card never re-formats them.
  assert.equal(card.changed![0]!.from, "5");
  assert.equal(card.changed![0]!.to, "5.5");
});

test("no previous run means no diff block rather than an empty one", () => {
  const card = build("full", {}, { setupData: { camber_front: "-1.5" } });
  assert.equal(card.changed, null);
});

// --------------------------------------------------------------------------
// The refusal rule
// --------------------------------------------------------------------------

test("a run with no laps and no setup is not shareable", () => {
  assert.equal(runIsShareable({ lapTimes: [] }, false), false);
});

test("laps alone, or a setup alone, is enough", () => {
  assert.equal(runIsShareable({ lapTimes: [] }, true), true);
  assert.equal(runIsShareable({ lapTimes: LAPS }, false), true);
});

// --------------------------------------------------------------------------
// Section round-trip
// --------------------------------------------------------------------------

test("sections survive the round trip through the query string", () => {
  const sections = { pace: true, laps: false, graph: true, notes: true };
  assert.deepEqual(parseSectionsParam(serializeSections(sections)), sections);
});

test("an unknown section name is ignored, not an error", () => {
  assert.deepEqual(parseSectionsParam("laps,telemetry"), {
    pace: false,
    laps: true,
    graph: false,
    notes: false,
  });
});

test("full run defaults everything on, headline defaults everything off", () => {
  assert.deepEqual(defaultSectionsForMode("full"), {
    pace: false,
    laps: true,
    graph: true,
    notes: true,
  });
  assert.deepEqual(defaultSectionsForMode("headline"), {
    pace: false,
    laps: false,
    graph: false,
    notes: false,
  });
});

// --------------------------------------------------------------------------
// Height — satori clips, so an under-estimate eats the footer
// --------------------------------------------------------------------------

test("every section that is added makes the card taller", () => {
  const headline = build("headline").height;
  const withPace = build("headline", { pace: true }, { paceVsFieldSeconds: -0.184 }).height;
  const withLaps = build("headline", { laps: true }).height;
  const full = build("full").height;

  assert.ok(withPace > headline, "the fifth tile takes a row");
  assert.ok(withLaps > headline, "nineteen laps take several");
  assert.ok(full > withLaps, "and the full run is taller than any single addition");
});

test("longer notes make the card taller, so the text can't run off the bottom", () => {
  const short = build("full").height;
  const long = buildShareRunCard({
    run: run({ notes: "x ".repeat(600) }),
    mode: "full",
    sections: defaultSectionsForMode("full"),
    dateTimeLabel: "9 Aug 2026, 10:42",
  }).height;
  assert.ok(long > short + 400, `expected a lot more room, got ${long - short}px`);
});

test("the height is the estimator's, not something the builder invented", () => {
  const card = build("full");
  assert.equal(card.height, estimateCardHeight(card));
});

test("wrapping counts a hard newline as its own line", () => {
  assert.equal(wrappedLines("", 30, 900), 0);
  assert.equal(wrappedLines("short", 30, 900), 1);
  assert.equal(wrappedLines("a\nb\nc", 30, 900), 3);
});
