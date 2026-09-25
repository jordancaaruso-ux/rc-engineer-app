import "server-only";

import satori from "satori";
import sharp from "sharp";
import { FONT_STORY, shareCardFonts } from "@/lib/share/shareFonts";
import { fitTextSize } from "@/lib/share/textMeasure";
import { CARD_SHADOW, P, ShadowStrip, col } from "@/lib/share/paperParts";
import { StoryLogo } from "@/lib/share/storyLooks";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

/**
 * The setup sheet as a story page: the driver's own sheet, untouched, sitting on the app's paper at
 * 9:16 with the car and the day above it (founder, 2026-09-25: "sheet on a story page"). The heading
 * is set in the story looks' condensed capitals ("match the font style of the other ones").
 *
 * The sheet itself is never redrawn: satori draws the page around an empty card, and the sheet's
 * own raster is composited into that card by sharp at exact pixels. So what sits in the frame is
 * the same picture the plain share sends, only framed.
 */

export type SheetStoryHeading = {
  carName: string;
  /** `SUN 9 AUG 2026`. */
  dateCaps: string | null;
  /** Track, session and driver, in that order; any may be missing. */
  details: (string | null)[];
};

const MARGIN_X = 44;
/** The white card's padding around the sheet — enough to read as a sheet laid on a card. */
const MAT = 16;
/** Where the heading ends and the sheet's space begins. */
const SHEET_TOP = 432;
/** The sheet's space ends here; below it only the signature, under Instagram's reply bar. */
const SHEET_BOTTOM = STORY_HEIGHT - 92;

export async function composeSheetStory(sheetPng: Buffer, heading: SheetStoryHeading): Promise<Buffer> {
  const meta = await sharp(sheetPng).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;

  const maxW = STORY_WIDTH - MARGIN_X * 2 - MAT * 2;
  const maxH = SHEET_BOTTOM - SHEET_TOP - MAT * 2;
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const sheetW = Math.round(srcW * scale);
  const sheetH = Math.round(srcH * scale);
  const cardW = sheetW + MAT * 2;
  const cardH = sheetH + MAT * 2;
  const cardX = Math.round((STORY_WIDTH - cardW) / 2);
  // A landscape sheet leaves room below; centre it in its space rather than hang it under the title.
  const cardY = Math.round(SHEET_TOP + (SHEET_BOTTOM - SHEET_TOP - cardH) / 2);

  const titleW = STORY_WIDTH - (cardX + 8) * 2;
  const carName = heading.carName.toUpperCase();
  const titleSize = fitTextSize(FONT_STORY, carName, titleW, { max: 118, min: 60, weight: 800 });
  const details = heading.details.filter(Boolean).join(" · ").toUpperCase();
  const detailSize = fitTextSize(FONT_STORY, details, titleW, { max: 30, min: 22, weight: 600, letterSpacingEm: 0.12 });
  const caps = (size: number, color: string, tracking: number) => ({
    display: "flex",
    fontFamily: FONT_STORY,
    fontWeight: 600,
    fontSize: size,
    color,
    lineHeight: 1,
    letterSpacing: Math.round(size * tracking),
  });

  const svg = await satori(
    <div style={{ ...col, position: "relative", width: STORY_WIDTH, height: STORY_HEIGHT, backgroundColor: P.ground }}>
      <div style={{ ...col, position: "absolute", left: cardX + 8, top: 206, width: titleW }}>
        <div style={caps(27, P.mut, 0.2)}>{["Setup sheet", heading.dateCaps].filter(Boolean).join(" · ").toUpperCase()}</div>
        <div
          style={{
            display: "flex",
            fontFamily: FONT_STORY,
            fontWeight: 800,
            fontSize: titleSize,
            color: P.ink,
            lineHeight: 0.9,
            marginTop: 14,
          }}
        >
          {carName}
        </div>
        {details ? <div style={{ ...caps(detailSize, P.mut, 0.12), marginTop: 16 }}>{details}</div> : null}
      </div>

      <ShadowStrip width={cardW} radius={28} shadow={CARD_SHADOW} left={cardX} bottom={STORY_HEIGHT - cardY - cardH} />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          borderRadius: 28,
          border: `2px solid ${P.cardEdge}`,
          backgroundColor: P.card,
        }}
      />

      <div style={{ display: "flex", position: "absolute", left: 0, top: SHEET_BOTTOM + 20, width: STORY_WIDTH, justifyContent: "center" }}>
        <StoryLogo color={P.ink} tile={40} text={24} />
      </div>
    </div>,
    { width: STORY_WIDTH, height: STORY_HEIGHT, fonts: shareCardFonts() }
  );

  const sheet = await sharp(sheetPng).resize({ width: sheetW, height: sheetH, fit: "fill" }).png().toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: sheet, left: cardX + MAT, top: cardY + MAT }])
    .png({ palette: true, quality: 92, effort: 4, dither: 0.6 })
    .toBuffer();
}
