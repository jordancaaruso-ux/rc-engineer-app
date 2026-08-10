import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import {
  deriveSchemaFromAcroForm,
  PLACEHOLDER_LABEL_PREFIX,
} from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS, isDebugSheetBlankId } from "@/lib/setupSheetModels/debugSheetBlanks";
import type { SheetFillField } from "@/components/setup/SheetFillSurface";

/**
 * The box list for a sheet, as ordinary JSON.
 *
 * WHY THIS IS AN ENDPOINT AND NOT A PROP. A 200-box sheet is a big value, and handing it to the
 * browser as a page prop means it travels through Next's streaming page format. In development
 * that format's decoder breaks when a single large value spans chunk boundaries, and the whole
 * page 500s — measured at roughly one load in three with 289 boxes, and never with 15.
 *
 * Fetching it here uses none of that machinery. It also keeps the page's own HTML small, lets the
 * box list cache on its own, and is the shape the real feature needs anyway, where the list comes
 * from a saved chassis rather than being worked out per request.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isDebugSheetBlankId(id)) {
    return NextResponse.json({ error: "Unknown blank" }, { status: 400 });
  }

  try {
    const bytes = await readFile(
      path.join(/* turbopackIgnore: true */ process.cwd(), DEBUG_SHEET_BLANKS[id].path)
    );
    const extraction = await extractPdfFormFields(Buffer.from(bytes));
    if (!extraction.hasFormFields) {
      return NextResponse.json({ error: "No form layer — this sheet is a scan" }, { status: 422 });
    }

    const derived = deriveSchemaFromAcroForm(extraction, DEBUG_SHEET_BLANKS[id].label);
    const fields: SheetFillField[] = derived.schema.fields.map((f) => ({
      key: f.key,
      label: f.displayLabel,
      unnamed: f.displayLabel.startsWith(PLACEHOLDER_LABEL_PREFIX),
      uiType: f.uiType === "checkbox" ? "checkbox" : "text",
      sectionTitle: f.sectionTitle,
      ...(f.groupedOptionLabels?.length ? { options: f.groupedOptionLabels } : {}),
    }));

    return NextResponse.json({
      fields,
      boxes: derived.boxes,
      pageCount: Math.max(...derived.boxes.map((b) => b.pageNumber), 1),
      namedCount: fields.filter((f) => !f.unnamed).length,
    });
  } catch {
    return NextResponse.json({ error: "Blank not readable" }, { status: 404 });
  }
}
