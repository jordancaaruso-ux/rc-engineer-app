import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS, isDebugSheetBlankId } from "@/lib/setupSheetModels/debugSheetBlanks";
import { fillPdfForm, type PdfFillMapping } from "@/lib/setupDocuments/fillPdfForm";

/**
 * The filled sheet as a PDF — the manufacturer's own blank with the driver's values in it.
 *
 * This is also the check on the fill surface: if what the app draws on screen and what a PDF viewer
 * draws from this file disagree, one of them is wrong about the sheet.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isDebugSheetBlankId(id)) {
    return NextResponse.json({ error: "Unknown blank" }, { status: 400 });
  }

  let values: Record<string, string> = {};
  try {
    const body = (await request.json()) as { values?: Record<string, string> };
    values = body?.values ?? {};
  } catch {
    return NextResponse.json({ error: "Expected { values }" }, { status: 400 });
  }

  try {
    const bytes = await readFile(
      path.join(/* turbopackIgnore: true */ process.cwd(), DEBUG_SHEET_BLANKS[id].path)
    );
    const extraction = await extractPdfFormFields(Buffer.from(bytes));
    const derived = deriveSchemaFromAcroForm(extraction, DEBUG_SHEET_BLANKS[id].label);

    const filled = await fillPdfForm({
      blank: new Uint8Array(bytes),
      mappings: derived.formFieldMappings as Record<string, PdfFillMapping>,
      values,
    });

    return new NextResponse(new Uint8Array(filled.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${id}-filled.pdf"`,
        // So the page can say what did not make it onto the paper without a second request.
        "X-Fill-Written": String(filled.written),
        "X-Fill-Skipped": String(filled.skipped.length),
        "X-Fill-Conflicts": String(filled.conflicts.length),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not fill this sheet" },
      { status: 500 }
    );
  }
}
