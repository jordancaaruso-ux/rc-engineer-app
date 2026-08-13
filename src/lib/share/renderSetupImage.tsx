import "server-only";

import sharp from "sharp";
import { ImageResponse } from "next/og";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";
import { CARD_WIDTH } from "@/lib/share/shareCardModel";
import { ensureRenderedSetupSnapshotPdf } from "@/lib/setup/ensureRunSetupPdf";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { SHARE_LIGHT } from "@/lib/share/shareTheme";

/**
 * A setup, as a picture of its own sheet.
 *
 * Almost nothing new is rendered: the app already turns a snapshot into a filled PDF
 * (`ensureRenderedSetupSnapshotPdf`) and a PDF page into a PNG (`renderPdfFirstPageToPng`,
 * pdfjs + `@napi-rs/canvas`, no headless browser). All this adds is the brand footer, so what
 * lands in a group chat is the driver's own paper — the thing racers recognise without reading.
 *
 * **The sheet is the only thing a setup share may ever look like** (founder call, 2026-08-13:
 * "the pdf appearance is what should surface always"). An earlier version fell back to an
 * app-rendered card of the same values when a chassis had no PDF; it was correct data wearing the
 * wrong clothes, and it read as a database dump next to a real sheet. It is gone. Where there is
 * no sheet there is no share, and the caller says so in words — see the route.
 *
 * A PNG rather than the PDF file itself, deliberately: a picture previews inline in every
 * messaging app, while a PDF arrives as a file chip most people never open. The appearance is the
 * sheet either way, which is what was actually asked for.
 *
 * The footer is drawn by `next/og` and pasted on with `sharp`, deliberately NOT written as SVG
 * text: sharp renders SVG through librsvg, which needs system fonts, and a serverless container
 * has none. `next/og` carries its own font, so the strip looks the same everywhere.
 */

const FOOTER_H = 104;

/**
 * A rendered sheet is a photograph of the driver's own paper and cannot be themed, so the strip
 * stamped under it is the app's LIGHT palette — the one case where a shared artifact isn't dark.
 */
const PAPER = SHARE_LIGHT;

/** The strip stamped along the bottom of a shared setup sheet. */
function FooterStrip({ width }: { width: number }) {
  return (
    <div
      style={{
        display: "flex",
        width,
        height: FOOTER_H,
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 44px",
        backgroundColor: PAPER.bg,
        borderTop: `2px solid ${PAPER.line}`,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{ display: "flex", width: 32, height: 32, borderRadius: 7, backgroundColor: PAPER.primary }}
        />
        <div style={{ display: "flex", fontSize: 27, color: PAPER.ink }}>{PRODUCT_NAME}</div>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: PAPER.faint }}>{BRAND_DOMAIN}</div>
    </div>
  );
}

async function pngBytes(image: ImageResponse): Promise<Buffer> {
  return Buffer.from(await image.arrayBuffer());
}

/**
 * The sheet image with the footer welded on.
 *
 * Exported only so `scripts/dev-share-card-shot.ts` can exercise it: the good path needs a
 * snapshot with a PDF template AND a calibration, which the demo account has none of, so this is
 * the only way to see the composite without signing in as a real driver.
 */
export async function stampFooter(sheetPng: Buffer): Promise<Buffer> {
  const scaled = await sharp(sheetPng).resize({ width: CARD_WIDTH }).png().toBuffer();
  const { height = 0 } = await sharp(scaled).metadata();

  const footer = await pngBytes(
    new ImageResponse(<FooterStrip width={CARD_WIDTH} />, { width: CARD_WIDTH, height: FOOTER_H })
  );

  return sharp(scaled)
    .extend({ bottom: FOOTER_H, background: PAPER.bg })
    .composite([{ input: footer, top: height, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * The driver's sheet as a PNG, or `null` when this chassis has no sheet the app can draw.
 *
 * Null is a real answer, not a failure to handle: the caller turns it into a sentence naming what
 * is missing. Measured 2026-08-13 on scratch-dev, 112 of 1,203 snapshots (9%) land here — every
 * one of them on a car with no chassis-model link, which is the thing to fix.
 */
export async function renderSetupSheetImage(params: {
  userId: string;
  setupSnapshotId: string;
}): Promise<Buffer | null> {
  const ensured = await ensureRenderedSetupSnapshotPdf({
    userId: params.userId,
    setupSnapshotId: params.setupSnapshotId,
  });
  if (!ensured) return null;

  try {
    const pdf = await readBytesFromStorageRef(ensured.relativePath);
    const sheet = await renderPdfFirstPageToPng(pdf);
    return await stampFooter(sheet);
  } catch {
    // An unreadable render is the same answer as no render: there is no sheet to send.
    return null;
  }
}
