import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { allSectionsOn, buildShareRunCard, type ShareRunInput } from "@/lib/share/shareCardModel";
import { renderReportPng } from "@/lib/share/renderReportCard";
import { renderStoryLook } from "@/lib/share/storyLooks";
import { buildStoryData, type StoryLook } from "@/lib/share/storyModel";
import { composeSheetStory } from "@/lib/share/renderSetupStory";
import { SHARE_PAPER } from "@/lib/share/shareTheme";

/**
 * The pictures, drawn for real. The models' tests pin WHAT travels; these pin what only a render can
 * prove: every story look is exactly the frame it claims (with and without a photo), and the long
 * picture is cut where its content ends — never mid-card (satori clips silently) and never with a
 * canvas of empty paper.
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

function card(overrides: Partial<ShareRunInput> = {}) {
  return buildShareRunCard({
    run: run(overrides),
    style: "report",
    sections: allSectionsOn(),
    dateTimeLabel: "Sun 9 Aug · 10:42",
    dateStamp: "SUN 9 AUG 2026",
    driverName: "Jordan Caruso",
  });
}

const STORY = buildStoryData({
  run: run(),
  dateStamp: "SUN 9 AUG 2026",
  accountName: "Jordan Caruso",
  field: { position: 1, fieldSize: 10, paceVsField: -0.333, fieldAveragePace: 15.9, timingName: null },
});

/** A stand-in phone photo: a gradient, so the blur and the crop have something to work on. */
async function photo(width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d6fd8"/><stop offset="1" stop-color="#e2388f"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

/** The colour of the picture's bottom row, as `#rrggbb`. */
async function bottomRow(png: Buffer): Promise<string> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (info.height - 1) * info.width * 3 + Math.floor(info.width / 2) * 3;
  return `#${[data[at], data[at + 1], data[at + 2]].map((v) => v!.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

test("every story look is exactly its frame: 1080 × 1920 story, 1080 × 1350 post", async () => {
  const portrait = await photo(1200, 1600);
  for (const look of ["A", "B", "C", "D"] as StoryLook[]) {
    for (const [frame, height] of [
      ["story", 1920],
      ["post", 1350],
    ] as const) {
      for (const withPhoto of [false, true]) {
        const jpeg = await renderStoryLook(STORY, { look, frame, photo: withPhoto ? portrait : null });
        const meta = await sharp(jpeg).metadata();
        const what = `${look} ${frame}${withPhoto ? " + photo" : ""}`;
        assert.equal(meta.format, "jpeg", `${what}: format`);
        assert.equal(meta.width, 1080, `${what}: width`);
        assert.equal(meta.height, height, `${what}: height`);
      }
    }
  }
});

test("a landscape photo and a run with no field still draw", async () => {
  const bare = buildStoryData({ run: run({ event: null }), dateStamp: "SUN 9 AUG 2026" });
  assert.equal(bare.finish, null);
  for (const look of ["A", "B", "C"] as StoryLook[]) {
    const meta = await sharp(await renderStoryLook(bare, { look, frame: "story", photo: await photo(1600, 900) })).metadata();
    assert.equal(meta.height, 1920, look);
  }
});

test("the long picture ends on its own paper, below the footer — cut to the content", async () => {
  const png = await renderReportPng(card(), { scale: 1 });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1080);
  // Far below the 9000px layout canvas: the cut happened.
  assert.ok(meta.height! > 2000 && meta.height! < 6000, `height ${meta.height}`);
  assert.equal(await bottomRow(png), SHARE_PAPER.ground, "the last row is bare page, so nothing was clipped");
});

test("a longer note makes the long picture taller rather than clipping it", async () => {
  const short = await sharp(await renderReportPng(card(), { scale: 1 })).metadata();
  const longPng = await renderReportPng(card({ notes: "Loose on entry. ".repeat(120) }), { scale: 1 });
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
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
  }
});
