import test from "node:test";
import assert from "node:assert/strict";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { buildShareRunCard, allSectionsOn, CARD_WIDTH, type ShareRunInput } from "@/lib/share/shareCardModel";
import { RunCard, renderRunCard } from "@/lib/share/renderRunCard";
import { shareCardFonts } from "@/lib/share/shareFonts";

/**
 * The card is painted by satori + sharp rather than by `next/og`, for one reason only: that pair
 * exposes a paint resolution, which is where a share's whole wait lives (see `renderRunCard`).
 * The claim that justified the swap is that it changes NOTHING about the picture — at full scale
 * the two agree to the byte.
 *
 * This is that claim, kept honest. `satori` is pinned to 0.25.0 because that is the version
 * `@vercel/og` bundles; if either moves, the layout engines diverge and this test is how you find
 * out, rather than a driver finding out from a card that quietly lost a column.
 *
 * Full scale here on purpose — the point is engine parity, not the shipped resolution.
 */

const LAPS = [
  15.612, 15.388, 15.201, 15.114, 15.276, 15.198, 15.34, 15.402, 15.887, 15.455, 15.298, 15.221,
  15.377, 15.509, 15.664, 15.812, 16.104, 16.398, 15.744,
];

const RUN = {
  sessionType: "RACE_MEETING",
  meetingSessionType: "QUALIFYING",
  sessionLabel: "Q2",
  lapTimes: LAPS,
  notes:
    "Loose on entry once the fronts came in. Rear steps out under brakes into 1 and 3 — had to be gentle with it.",
  carRating: 7,
  tireRunNumber: 3,
  warmerTimingMinutes: 12,
  conditionsAirTempC: 24,
  conditionsTrackTempC: 33,
  carNameSnapshot: "Awesomatix A800RR",
  trackNameSnapshot: "Kingsway Raceway",
} as ShareRunInput;

const SETUP = { camberFront: -1.5, camberRear: -2, tyrePressureFront: 12 };
const PREVIOUS_SETUP = { camberFront: -1, camberRear: -2, tyrePressureFront: 14 };

function card(style: "hero" | "report") {
  return buildShareRunCard({
    run: RUN,
    style,
    sections: allSectionsOn(),
    dateTimeLabel: "Sun 9 Aug · 10:42",
    dateStamp: "SUN 9 AUG 2026",
    driverName: "Jordan Caruso",
    setupData: SETUP,
    previousSetupData: PREVIOUS_SETUP,
  });
}

/** Raw RGBA, so two different PNG encoders can't be mistaken for two different pictures. */
async function pixels(png: Buffer) {
  return await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

for (const style of ["hero", "report"] as const) {
  test(`${style} card: satori + sharp matches next/og pixel for pixel`, async () => {
    const built = card(style);

    const ours = Buffer.from(await (await renderRunCard(built, { scale: 1 })).arrayBuffer());
    const theirs = Buffer.from(
      await new ImageResponse(<RunCard card={built} />, {
        width: CARD_WIDTH,
        height: built.height,
        fonts: shareCardFonts(),
      }).arrayBuffer()
    );

    const a = await pixels(theirs);
    const b = await pixels(ours);

    assert.equal(b.info.width, CARD_WIDTH, "painted at design width when scale is 1");
    assert.equal(b.info.height, built.height);
    assert.deepEqual(
      { w: b.info.width, h: b.info.height, c: b.info.channels },
      { w: a.info.width, h: a.info.height, c: a.info.channels },
      "same dimensions"
    );

    let differing = 0;
    let worst = 0;
    for (let i = 0; i < a.data.length; i++) {
      const d = Math.abs(a.data[i]! - b.data[i]!);
      if (d > 0) differing++;
      if (d > worst) worst = d;
    }
    assert.equal(
      differing,
      0,
      `${differing} of ${a.data.length} colour channels differ (worst ${worst}/255) — the two ` +
        `layout engines have drifted apart; check that satori is still pinned to the version ` +
        `@vercel/og bundles.`
    );
  });
}

test("paint scale shrinks the picture without touching the layout", async () => {
  const built = card("report");
  const full = await pixels(Buffer.from(await (await renderRunCard(built, { scale: 1 })).arrayBuffer()));
  const half = await pixels(Buffer.from(await (await renderRunCard(built, { scale: 0.5 })).arrayBuffer()));

  assert.equal(half.info.width, Math.round(CARD_WIDTH * 0.5));
  assert.equal(half.info.height, Math.round(built.height * 0.5));

  /*
   * The trap this guards: a CSS `transform: scale()` on the tree also produces a smaller picture,
   * and silently drops whole tables and the lap trace while doing it. A true downscale keeps the
   * ink — so the scaled card must be about as busy as the full one, not emptier.
   */
  const inked = (p: typeof full) => {
    let n = 0;
    for (let i = 0; i < p.data.length; i += p.info.channels) {
      // Anything meaningfully lighter than the card's near-black ground counts as drawn.
      if (p.data[i]! > 40) n++;
    }
    return n / (p.info.width * p.info.height);
  };

  const fullInk = inked(full);
  const halfInk = inked(half);
  assert.ok(fullInk > 0.01, `full card should have ink, got ${(fullInk * 100).toFixed(2)}%`);
  assert.ok(
    halfInk > fullInk * 0.75,
    `scaled card lost content: ${(halfInk * 100).toFixed(2)}% inked vs ${(fullInk * 100).toFixed(2)}% at full size`
  );
});
