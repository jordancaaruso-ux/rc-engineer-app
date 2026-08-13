import assert from "node:assert/strict";
import test from "node:test";
import {
  allSectionsOn,
  buildShareRunCard,
  estimateCardHeight,
  parseCardStyle,
  parseSectionsParam,
  runIsShareable,
  serializeSections,
  wrappedLines,
  type ShareCardStyle,
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
    handlingAssessmentJson: {
      version: 6,
      balanceByPhase: { entry: -2, mid: 0 },
      onPower: -1,
    },
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

function build(style: ShareCardStyle, sections?: Partial<ShareSections>, extra = {}) {
  return buildShareRunCard({
    run: run(),
    style,
    sections: { ...allSectionsOn(), ...sections },
    dateTimeLabel: "9 Aug 2026, 10:42",
    dateStamp: "SUN 9 AUG 2026",
    driverName: "Jordan Caruso",
    ...extra,
  });
}

// --------------------------------------------------------------------------
// The four figures — always on the picture, whatever is toggled off
// --------------------------------------------------------------------------

test("the four figures are best, avg top 5, avg top 10, laps/time — in that order", () => {
  const card = build("report");
  assert.deepEqual(
    card.tiles.map((t) => t.label),
    ["Best lap", "Avg top 5", "Avg top 10", "Laps / time"]
  );
  assert.equal(card.tiles[0]!.value, "15.114");
  assert.match(card.tiles[3]!.value, /^19 \//);
});

test("the always-on set survives every chip being off", () => {
  const off: ShareSections = {
    details: false,
    laps: false,
    graph: false,
    setup: false,
    notes: false,
    feel: false,
  };
  for (const style of ["hero", "report"] as const) {
    const card = buildShareRunCard({
      run: run(),
      style,
      sections: off,
      dateTimeLabel: "9 Aug 2026, 10:42",
      driverName: "Jordan Caruso",
    });
    assert.equal(card.tiles.length, 4, `${style}: the four figures stay`);
    assert.equal(card.tiles[0]!.value, "15.114", `${style}: best lap stays`);
    assert.equal(card.driverName, "Jordan Caruso", `${style}: the driver stays`);
    assert.equal(card.title, "Qualifying · Q2", `${style}: the session stays`);
    assert.equal(card.laps, null);
    assert.equal(card.trace, null);
    assert.equal(card.notes, null);
    assert.equal(card.feel, null);
  }
});

test("the track is on the picture in both styles, whatever is off", () => {
  assert.match(build("report", { details: false }).subtitle, /Barton Park/);
  assert.match(
    buildShareRunCard({
      run: run(),
      style: "hero",
      sections: { ...allSectionsOn(), details: false },
      dateTimeLabel: "9 Aug 2026, 10:42",
      driverName: "Jordan Caruso",
    }).subtitle,
    /Barton Park/
  );
});

// --------------------------------------------------------------------------
// Report mirrors the expanded session view
// --------------------------------------------------------------------------

test("report shows the six session details and all nine lap figures", () => {
  const card = build("report");
  assert.deepEqual(
    card.details.map((d) => d.label),
    ["Date / time", "Session", "Car", "Tire set", "Additive", "Tire prep"]
  );
  assert.deepEqual(
    card.lapWells.map((w) => w.label),
    ["Laps", "Stint", "Best lap", "Avg top 5", "Avg top 10", "Median", "Cond.", "Consist.", "Mistakes"]
  );
});

test("the nine lap figures are not chip-controlled — only Session details is", () => {
  const card = build("report", { details: false });
  assert.equal(card.details.length, 0);
  assert.equal(card.lapWells.length, 9, "Laptimes always travels on a report");
});

test("hero carries no wells; its identity is the two lines under the driver", () => {
  const card = build("hero");
  assert.equal(card.details.length, 0);
  assert.equal(card.lapWells.length, 0);
  assert.equal(card.heroLines.length, 2);
  assert.match(card.heroLines[0]!, /Q2 · Round 4/);
  assert.match(card.heroLines[1]!, /Barton Park Raceway · Awesomatix A800RR/);
});

test("turning Session details off drops the hero's lines, not its lap", () => {
  const card = build("hero", { details: false });
  assert.deepEqual(card.heroLines, []);
  assert.equal(card.tiles[0]!.value, "15.114");
});

// --------------------------------------------------------------------------
// Chips mean only themselves — nothing overrides anything
// --------------------------------------------------------------------------

test("each chip governs exactly one block", () => {
  assert.equal(build("report", { laps: false }).laps, null);
  assert.ok(build("report", { laps: false }).trace, "the trace is a different chip");
  assert.equal(build("report", { graph: false }).trace, null);
  assert.ok(build("report", { graph: false }).laps, "the laps are a different chip");
  assert.equal(build("report", { notes: false }).notes, null);
  assert.ok(build("report", { notes: false }).feel, "how it felt is a different chip now");
  assert.equal(build("report", { feel: false }).feel, null);
  assert.ok(build("report", { feel: false }).notes, "and the notes are untouched");
});

// --------------------------------------------------------------------------
// Flags on laps
// --------------------------------------------------------------------------

test("the best lap is flagged and the slow ones are marked as mistakes", () => {
  const card = build("report");
  const best = card.laps!.filter((l) => l.flag === "best");
  assert.equal(best.length, 1);
  assert.equal(best[0]!.time, "15.114");
  assert.ok(
    card.laps!.some((l) => l.flag === "miss"),
    "16.398 is well off this session's median"
  );
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
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  });
  const excluded = card.laps!.filter((l) => l.excluded);
  assert.equal(excluded.length, 1, "a struck-through lap is still part of the record");
});

// --------------------------------------------------------------------------
// Trace direction — the app plots slow at the top (LapTimeGraph's yAt), and a card
// that disagreed with the screen it came from would be worse than either convention.
// --------------------------------------------------------------------------

test("slower plots HIGHER: the fastest lap sits lowest on the trace", () => {
  const trace = build("report").trace!;
  const ys = trace.dots.map((d) => d.y);
  const fastestIndex = LAPS.indexOf(Math.min(...LAPS));
  // SVG y grows downward, so the fastest lap has the LARGEST y.
  assert.equal(trace.dots[fastestIndex]!.y, Math.max(...ys), "15.114 is the bottom of the trace");
  assert.ok(trace.dots[fastestIndex]!.flag === "best");
});

test("the trace stays inside its own box", () => {
  const trace = build("report").trace!;
  for (const d of trace.dots) {
    assert.ok(d.x >= 72 && d.x <= 948, `x ${d.x} is inside the plot area`);
    assert.ok(d.y >= 24 && d.y <= 256, `y ${d.y} is inside the plot area`);
  }
  assert.equal(trace.gridlines.length, 3);
  assert.ok(trace.xLabels.length > 0);
});

test("a lap well off clean pace pins to the top edge as a clamped point", () => {
  const card = buildShareRunCard({
    run: run({ lapTimes: [...LAPS, 22.4] }),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  });
  const clamped = card.trace!.dots.filter((d) => d.clamped);
  assert.equal(clamped.length, 1, "22.4 is past best × 1.15");
});

test("two laps are not a trace", () => {
  const card = buildShareRunCard({
    run: run({ lapTimes: [15.1, 15.3] }),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  });
  assert.equal(card.trace, null);
});

// --------------------------------------------------------------------------
// How the car felt — a read-back of the capture controls, bands from the shared source
// --------------------------------------------------------------------------

test("the rating bands come from CAR_RATING_BANDS, with the driver's number lit", () => {
  const feel = build("report").feel!;
  assert.deepEqual(
    feel.bands.map((b) => b.caption),
    ["Bad", "Workable", "Good", "Dialled"]
  );
  assert.equal(feel.rating, 7);
  assert.equal(feel.bandCaption, "Good");
  assert.deepEqual(
    feel.bands.filter((b) => b.active).map((b) => b.caption),
    ["Good"]
  );
});

test("only answered corner phases are drawn, and neutral is one of the answers", () => {
  const feel = build("report").feel!;
  assert.deepEqual(
    feel.balance!.map((b) => [b.label, b.value]),
    [
      ["Entry", -2],
      ["Mid", 0],
    ]
  );
});

test("unflagged notables are kept — they are what was considered and dismissed", () => {
  const feel = build("report").feel!;
  assert.equal(feel.notables.length, 6, "five axes, and steering feel has two poles");
  const flagged = feel.notables.filter((n) => n.severity != null);
  assert.deepEqual(flagged, [{ label: "Snaps on power", severity: 1 }]);
});

test("a run with nothing answered draws no felt block at all", () => {
  const card = buildShareRunCard({
    run: run({ carRating: null, handlingAssessmentJson: null }),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  });
  assert.equal(card.feel, null);
});

// --------------------------------------------------------------------------
// Setup diff
// --------------------------------------------------------------------------

test("setup diff is what changed since the previous run, new value first", () => {
  const card = build(
    "report",
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
  const card = build("report", {}, { setupData: { camber_front: "-1.5" } });
  assert.equal(card.changed, null);
});

test("the setup chip off means the diff is never even asked for", () => {
  const card = build(
    "report",
    { setup: false },
    {
      setupData: { ride_height_rear: "5.5" },
      previousSetupData: { ride_height_rear: "5.0" },
    }
  );
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
// Query-string round trip
// --------------------------------------------------------------------------

test("sections survive the round trip through the query string", () => {
  const sections: ShareSections = {
    details: true,
    laps: false,
    graph: true,
    setup: false,
    notes: true,
    feel: true,
  };
  assert.deepEqual(parseSectionsParam(serializeSections(sections)), sections);
});

test("an unknown section name is ignored, not an error", () => {
  assert.deepEqual(parseSectionsParam("laps,telemetry"), {
    details: false,
    laps: true,
    graph: false,
    setup: false,
    notes: false,
    feel: false,
  });
});

test("the style defaults to hero and only 'report' moves it", () => {
  assert.equal(parseCardStyle(null), "hero");
  assert.equal(parseCardStyle("nonsense"), "hero");
  assert.equal(parseCardStyle("hero"), "hero");
  assert.equal(parseCardStyle("report"), "report");
});

test("everything on is everything on", () => {
  assert.deepEqual(allSectionsOn(), {
    details: true,
    laps: true,
    graph: true,
    setup: true,
    notes: true,
    feel: true,
  });
});

// --------------------------------------------------------------------------
// Height — satori clips, so an under-estimate eats the footer
// --------------------------------------------------------------------------

test("every section that is added makes the card taller", () => {
  const bare: ShareSections = {
    details: false,
    laps: false,
    graph: false,
    setup: false,
    notes: false,
    feel: false,
  };
  const base = buildShareRunCard({
    run: run(),
    style: "hero",
    sections: bare,
    dateTimeLabel: "9 Aug 2026, 10:42",
  }).height;

  for (const key of ["laps", "graph", "notes", "feel"] as const) {
    const withOne = buildShareRunCard({
      run: run(),
      style: "hero",
      sections: { ...bare, [key]: true },
      dateTimeLabel: "9 Aug 2026, 10:42",
    }).height;
    assert.ok(withOne > base, `${key} takes room on the card`);
  }

  const all = build("hero").height;
  assert.ok(all > base, "and everything together is taller than any one of them");
});

test("a report is taller than a hero of the same run — it says more", () => {
  assert.ok(build("report").height > build("hero").height);
});

test("longer notes make the card taller, so the text can't run off the bottom", () => {
  const short = build("report").height;
  const long = buildShareRunCard({
    run: run({ notes: "x ".repeat(600) }),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  }).height;
  assert.ok(long > short + 400, `expected a lot more room, got ${long - short}px`);
});

test("more laps make the card taller — every lap chip has to fit", () => {
  const short = build("report").height;
  const long = buildShareRunCard({
    run: run({ lapTimes: [...LAPS, ...LAPS] }),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "9 Aug 2026, 10:42",
  }).height;
  assert.ok(long > short, "38 laps take more chip rows than 19");
});

test("the height is the estimator's, not something the builder invented", () => {
  for (const style of ["hero", "report"] as const) {
    const card = build(style);
    assert.equal(card.height, estimateCardHeight(card));
  }
});

test("wrapping counts a hard newline as its own line", () => {
  assert.equal(wrappedLines("", 30, 900), 0);
  assert.equal(wrappedLines("short", 30, 900), 1);
  assert.equal(wrappedLines("a\nb\nc", 30, 900), 3);
});
