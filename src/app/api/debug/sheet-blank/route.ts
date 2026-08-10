import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEBUG_SHEET_BLANKS, isDebugSheetBlankId } from "@/lib/setupSheetModels/debugSheetBlanks";
import sharp from "sharp";
import { renderPdfPageToPng } from "@/lib/setupDocuments/pdfServerRaster";

/**
 * Serves one of the manufacturer blanks checked into the repo, so the fill surface can be tried on
 * a phone against a real 200-box sheet without uploading anything or touching the database.
 *
 * Dev only — these files live under `scripts/`, not `public/`, and this reads from the repo tree.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  if (!isDebugSheetBlankId(id)) {
    return NextResponse.json({ error: "Unknown blank" }, { status: 400 });
  }
  const pageNumber = Number(params.get("page") ?? "1");

  try {
    const bytes = await readFile(
      path.join(/* turbopackIgnore: true */ process.cwd(), DEBUG_SHEET_BLANKS[id].path)
    );
    // A picture of the page, not the PDF: the phone showing it never loads a PDF engine.
    const png = await renderPdfPageToPng(new Uint8Array(bytes), pageNumber, { scale: 2 });
    // WebP, because the PNG of an A4 sheet is around 1 MB and this gets opened on club wifi at a
    // track. Lossless keeps the printed captions sharp when a box is zoomed right in — the whole
    // point of showing the real sheet is that the driver can read what is printed beside the box.
    const webp = await sharp(png).webp({ lossless: true, effort: 4 }).toBuffer();
    return new NextResponse(new Uint8Array(webp), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Blank not readable" }, { status: 404 });
  }
}
