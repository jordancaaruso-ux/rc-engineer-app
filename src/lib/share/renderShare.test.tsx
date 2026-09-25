import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { allSectionsOn, buildShareRunCard, type ShareRunInput } from "@/lib/share/shareCardModel";
import { renderReportPng } from "@/lib/share/renderReportCard";
import { renderStoryPng, STORY_HEIGHT, STORY_TRACE, STORY_WIDTH } from "@/lib/share/renderStoryCard";
import { composeSheetStory } from "@/lib/share/renderSetupStory";
import { SHARE_PAPER } from "@/lib/share/shareTheme";

/**
 * The pictures, drawn for real. The model's tests pin WHAT travels; these pin the two things only a
 * render can prove: a story is exactly the frame a story is, and the long picture is cut where its
 * content ends — never mid-card (satori clips silently) and never with a canvas of empty paper.
 *
 *   npm run test:share-render
 */

const LAPS = [
  15.612, 15.388, 15.201, 15.114, 15.276, 15.198, 15.34, 15.402, 15.887, 15.455, 15.298, 15.221, 15.377,
  15.509, 15.664, 15.812, 16.104, 16.398, 15.744,
];

function run(overrides: Partial<ShareRunInput> = {}): ShareRunInput {
  return {
    sessionType: "RACE_MEETING",
    meetingSessionType: "QUALIFYING",
    sessionLabel: "Q2",
    lapTimes: LAPS,
    notes: "Loose on entry once the fronts came in.",
    carRating: 7,
    handlingAssessmentJson: { version: 6, balanceByPhase: { entry: -2, mid: 0, exit: 1 }, braking: -2 },
    car: { name: "Awesomatix A800RR" },
    track: { name: "Barton Park Raceway" },
    event: { name: "Round 4 — NSW State Series" },
    ...overrides,
  };
}

function card(style: "story" | "report", overrides: Partial<ShareRunInput> = {}) {
  return buildShareRunCard({
    run: run(overrides),
    style,
    sections: allSectionsOn(),
    dateTimeLabel: "Sun 9 Aug · 10:42",
    dateStamp: "SUN 9 AUG 2026",
    driverName: "Jordan Caruso",
    traceBox: style === "story" ? STORY_TRACE : undefined,
  });
}

/** The colour of the picture's bottom row, as `#rrggbb`. */
async function bottomRow(png: Buffer): Promise<string> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (info.height - 1) * info.width * 3 + Math.floor(info.width / 2) * 3;
  return `#${[data[at], data[at + 1], data[at + 2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

test("a story is exactly a story frame: 1080 × 1920", async () => {
  for (const variant of ["app", "poster", "yellow"] as const) {
    const meta = await sharp(await renderStoryPng(card("story"), variant)).metadata();
    assert.equal(meta.width, STORY_WIDTH, `${variant}: width`);
    assert.equal(meta.height, STORY_HEIGHT, `${variant}: height`);
  }
});

test("the long picture ends on its own paper, below the footer — cut to the content", async () => {
  const png = await renderReportPng(card("report"), { scale: 1 });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1080);
  // Far below the 9000px layout canvas: the cut happened.
  assert.ok(meta.height! > 2000 && meta.height! < 6000, `height ${meta.height}`);
  assert.equal(await bottomRow(png), SHARE_PAPER.ground, "the last row is bare page, so nothing was clipped");
});

test("a longer note makes the long picture taller rather than clipping it", async () => {
  const short = await sharp(await renderReportPng(card("report"), { scale: 1 })).metadata();
  const longPng = await renderReportPng(card("report", { notes: "Loose on entry. ".repeat(120) }), { scale: 1 });
  const long = await sharp(longPng).metadata();
  assert.ok(long.height! > short.height! + 400, `grew by ${long.height! - short.height!}px`);
  assert.equal(await bottomRow(longPng), SHARE_PAPER.ground);
});

test("the sheet's story page is a story frame, portrait sheet or landscape", async () => {
  for (const [w, h] of [
    [1190, 1683],
    [1683, 1190],
  ]) {
    const sheet = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const page = await composeSheetStory(sheet, {
      carName: "A800RR",
      dateCaps: "SUN 19 JUL 2026",
      details: ["TFTR", "Testing run", "Jordan Caruso"],
    });
    const meta = await sharp(page).metadata();
    assert.equal(meta.width, STORY_WIDTH);
    assert.equal(meta.height, STORY_HEIGHT);
  }
});
