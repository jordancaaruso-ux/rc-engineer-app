import "server-only";

import satori from "satori";
import sharp from "sharp";
import { shareCardFonts } from "@/lib/share/shareFonts";
import { fitSoraSize } from "@/lib/share/textMeasure";
import { CARD_SHADOW, Lockup, P, ShadowStrip, TitleRule, col, eyebrow, sora } from "@/lib/share/paperParts";
import { STORY_HEIGHT, STORY_WIDTH } from "@/lib/share/renderStoryCard";

/**
 * The setup sheet as a story page: the driver's own sheet, untouched, sitting on the app's paper at
 * 9:16 with the car and the day above it (founder, 2026-09-25: "sheet on a story page").
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
  const titleSize = fitSoraSize(heading.carName, titleW, { max: 76, min: 46, weight: 700, letterSpacingEm: -0.02 });
  const details = heading.details.filter(Boolean).join(" · ");
  const detailSize = fitSoraSize(details, titleW, { max: 32, min: 24, weight: 500 });

  const svg = await satori(
    <div style={{ ...col, position: "relative", width: STORY_WIDTH, height: STORY_HEIGHT, backgroundColor: P.ground }}>
      <div style={{ ...col, position: "absolute", left: cardX + 8, top: 196, width: titleW }}>
        <div style={eyebrow(27)}>{["Setup sheet", heading.dateCaps].filter(Boolean).join(" · ")}</div>
        <div style={{ ...sora(titleSize, 700, P.ink, 1.1), letterSpacing: -titleSize * 0.02, marginTop: 10 }}>
          {heading.carName}
        </div>
        <div style={{ display: "flex", marginTop: 16 }}>
          <TitleRule width={titleW} thickness={4} sectorAt={0} />
        </div>
        {details ? <div style={{ ...sora(detailSize, 500, P.mut, 1.3), marginTop: 18 }}>{details}</div> : null}
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
        <Lockup tile={40} text={24} />
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
