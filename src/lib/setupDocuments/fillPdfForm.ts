import "server-only";

import {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { acroFieldTypeName, orderedFieldWidgets } from "@/lib/setupDocuments/pdfFormFields";
import { parseDefaultAppearance, parsePdfFontName } from "@/lib/setupDocuments/pdfFieldAppearance";

/**
 * Write a driver's answers back into the manufacturer's own blank, so what comes out is their
 * setup sheet — the same paper, filled in.
 *
 * WHY NOT DRAW OUR OWN. The blank already knows how it wants to look: the font, size and colour
 * for every value, and a custom appearance for every tick box (Xray crosses, Mugen bullets). Values
 * are set as form values and the file is asked to redraw them, which is what a viewer does when you
 * fill the sheet in Acrobat. Letting pdf-lib regenerate the appearances instead would repaint every
 * tick box as its own plain square and drop the manufacturer's fonts — a sheet that no longer looks
 * like the sheet.
 *
 * WHAT IT CANNOT DO, and says so rather than guessing:
 *
 *  - **A row of tick boxes sharing one name is one choice in the file.** The boxes have distinct
 *    on-states (`/1`, `/2`, `/3`), so the PDF can only ever hold one of them ticked — measured on
 *    all three repo blanks, 130 of 135 such rows. The app lets a driver tick several because
 *    splitting them is the recoverable choice; on the way out only the first survives, and the rest
 *    come back as conflicts.
 *  - **Several boxes sharing one text field show the same text.** Same reason: one field, one
 *    value, however many places it is printed.
 */

export type PdfFillMapping = { pdfFieldName: string; widgetInstanceIndex?: number };

export type PdfFillResult = {
  bytes: Uint8Array;
  /** Parameters that reached the paper. */
  written: number;
  /** Parameters whose box could not be found or written — key + why. */
  skipped: string[];
  /** Parameters the file cannot hold at the same time, and which one won. */
  conflicts: string[];
};

const OFF = PDFName.of("Off");

/**
 * The nearest of the fourteen fonts every PDF reader must have, to a font this sheet names.
 *
 * WHY NOT JUST THE ONE FONT. The baked drawing below used plain Helvetica for every sheet. In
 * Acrobat that is invisible — `NeedAppearances` makes it redraw in the sheet's own face — but in
 * Preview, Chrome's viewer and iOS Quick Look, none of which honour that flag, a sheet printed in
 * navy Verdana Italic came back with its values in upright Helvetica. Measured on the A800RR blank
 * 2026-08-14: the field says `/Verdana,Italic 0 Tf 1 0 0 rg`, the baked stream said `/Helvetica`.
 *
 * Verdana itself cannot be embedded — it is not ours to ship, and the blank does not carry it — so
 * the closest honest answer is the base-14 face of the right CLASS: serif stays serif, fixed stays
 * fixed, and italic stays italic. Upright-vs-italic is the difference a driver actually notices.
 */
function nearestStandardFont(fontName: string | undefined): StandardFonts {
  const { family, bold, italic } = parsePdfFontName(fontName ?? "Helv");
  const f = family.toLowerCase();
  if (f.includes("courier") || f.includes("mono") || f.includes("consol")) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  // Times covers the serif faces a setup sheet is likely to name — Times, Georgia, Garamond, Book.
  if (f.includes("times") || f.includes("georgia") || f.includes("garamond") || f.includes("serif")
      || f.includes("roman") || f.includes("book") || f.includes("minion")) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/**
 * Draw every text value into the file, for readers that show only what is already drawn.
 *
 * The field's own instructions are put back afterwards. pdf-lib rewrites them to name the font it
 * just used, which would leave a viewer that redraws — Acrobat, with `NeedAppearances` set — using
 * a substitute instead of the manufacturer's Verdana Italic. Restoring them costs nothing and keeps
 * the good case good; `nearestStandardFont` is what the other readers get.
 *
 * Fonts are embedded once each and reused: a sheet has one or two faces across two hundred fields,
 * and embedding per field would put two hundred copies of Helvetica in the file.
 */
async function bakeTextAppearances(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  formDa: string | undefined
): Promise<void> {
  const embedded = new Map<StandardFonts, Awaited<ReturnType<PDFDocument["embedFont"]>>>();
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    if (!field.getText()) continue;
    try {
      const originalDa = field.acroField.getDefaultAppearance();
      const named = parseDefaultAppearance(originalDa ?? formDa).fontName;
      const standard = nearestStandardFont(named);
      let font = embedded.get(standard);
      if (!font) {
        font = await pdfDoc.embedFont(standard);
        embedded.set(standard, font);
      }
      field.defaultUpdateAppearances(font);
      if (originalDa) field.acroField.setDefaultAppearance(originalDa);
    } catch {
      // A field pdf-lib cannot draw still carries its value; a viewer that redraws will show it.
    }
  }
}

/** The default appearance the whole form declares, for fields that state none of their own. */
function formDefaultAppearance(form: ReturnType<PDFDocument["getForm"]>): string | undefined {
  try {
    const da = form.acroForm.dict.lookup(PDFName.of("DA")) as { asString?: () => string } | undefined;
    return da?.asString?.();
  } catch {
    return undefined;
  }
}

export async function fillPdfForm(input: {
  blank: Uint8Array;
  /** Schema key -> where that parameter lives on this blank. */
  mappings: Record<string, PdfFillMapping>;
  /** Schema key -> what the driver put in it. Empty strings are left blank. */
  values: Record<string, string>;
}): Promise<PdfFillResult> {
  const pdfDoc = await PDFDocument.load(input.blank, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  const skipped: string[] = [];
  const conflicts: string[] = [];
  let written = 0;

  // One PDF field can carry several of our parameters, and they have to be decided together —
  // a row of tick boxes only has room for one answer.
  const byField = new Map<string, { key: string; mapping: PdfFillMapping; value: string }[]>();
  for (const [key, mapping] of Object.entries(input.mappings)) {
    const name = mapping?.pdfFieldName;
    if (!name) continue;
    const value = (input.values[key] ?? "").trim();
    const list = byField.get(name) ?? [];
    list.push({ key, mapping, value });
    byField.set(name, list);
  }

  for (const [name, entries] of byField) {
    const field = form.getFieldMaybe(name);
    if (!field) {
      for (const e of entries) if (e.value) skipped.push(`${e.key}: no field named "${name}"`);
      continue;
    }

    const filled = entries.filter((e) => e.value !== "");

    // --- tick boxes -------------------------------------------------------------------
    if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
      const widgets = orderedFieldWidgets(pdfDoc, field);
      if (widgets.length === 0) {
        for (const e of filled) skipped.push(`${e.key}: "${name}" has no box on any page`);
        continue;
      }

      // Which box the driver ticked. A whole-field mapping means the field's only box.
      const ticked = filled
        .map((e) => e.mapping.widgetInstanceIndex ?? 0)
        .filter((i) => i >= 0 && i < widgets.length)
        .sort((a, b) => a - b);

      if (ticked.length > 1) {
        const winner = filled.find((e) => (e.mapping.widgetInstanceIndex ?? 0) === ticked[0])?.key ?? "";
        conflicts.push(
          `"${name}" can only hold one tick — kept ${winner}, dropped ${ticked.length - 1} more`
        );
      }

      const chosen = ticked.length > 0 ? widgets[ticked[0]!] : null;
      const onValue = chosen ? (chosen.widget.getOnValue() as PDFName | undefined) : undefined;
      // Set the field's value AND each box's appearance state. pdf-lib's own `check()` refuses any
      // box but the first, and these sheets use the second and third constantly.
      field.acroField.dict.set(PDFName.of("V"), onValue ?? OFF);
      for (const w of widgets) {
        const on = w.widget.getOnValue();
        w.widget.setAppearanceState(onValue && on === onValue ? onValue : OFF);
      }
      written += ticked.length > 0 ? 1 : 0;
      continue;
    }

    // --- a stated list of choices -----------------------------------------------------
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const value = filled[0]?.value;
      if (!value) continue;
      try {
        field.select(value);
        written += 1;
      } catch {
        skipped.push(`${filled[0]!.key}: "${value}" is not one of "${name}"'s choices`);
      }
      continue;
    }

    // --- text -------------------------------------------------------------------------
    if (field instanceof PDFTextField) {
      if (filled.length === 0) continue;
      if (filled.length > 1) {
        const distinct = new Set(filled.map((e) => e.value));
        if (distinct.size > 1) {
          conflicts.push(
            `"${name}" prints one value in ${filled.length} places — kept ${filled[0]!.key}`
          );
        }
      }
      try {
        field.setText(filled[0]!.value);
        written += 1;
      } catch (e) {
        skipped.push(`${filled[0]!.key}: ${e instanceof Error ? e.message : "could not be written"}`);
      }
      continue;
    }

    // Not `constructor.name`: minified in the server build, where every class answers to a letter.
    for (const e of filled) skipped.push(`${e.key}: "${name}" is a ${acroFieldTypeName(field)}`);
  }

  /*
   * Two ways of drawing the values, on purpose.
   *
   * `NeedAppearances` asks the viewer to draw them itself from the instructions already in the file
   * — the manufacturer's own font and colour. That is what makes an exported sheet look like one
   * somebody filled in Acrobat, and it is what Acrobat does with this flag.
   *
   * But not every viewer obeys it, and a sheet that opens blank is worse than one that opens plain.
   * So a drawn version is baked in as well, using a standard font, for readers that just show what
   * is in the file. Whichever the driver opens it in, the values are there.
   *
   * Only text is drawn this way. Tick boxes keep the appearances the manufacturer drew — Xray's
   * cross, Mugen's bullet — because redrawing those would replace the sheet's own marks with plain
   * squares, and nothing is gained: flipping which appearance is showing is enough.
   */
  await bakeTextAppearances(pdfDoc, form, formDefaultAppearance(form));
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { bytes, written, skipped, conflicts };
}

/*
 * DO NOT FLATTEN THIS FILE ON THE WAY TO A PICTURE. Tried and rejected 2026-08-14.
 *
 * The worry was that pdfjs — which turns a sheet into the PNG a driver shares — might not draw form
 * widgets when it rasterizes. Checked by rendering the Xray '26 and Mugen MTC3 blanks both ways:
 * pdfjs draws them, manufacturer marks and all. And flattening makes the picture WORSE, because a
 * box the sheet sizes automatically (Xray's comments line) gets its text burnt in at the wrong size,
 * while the live file lets the renderer size it as the sheet intends.
 *
 * pdf-lib's `flatten()` also throws outright on all three repo blanks (`Failed to extract appearance
 * ref`): an unticked box carries `/AS /Off` and stores no `/Off` appearance, because an unticked box
 * draws nothing. That is ordinary, valid PDF — 182 such widgets on the Xray '26 sheet alone — and
 * pdf-lib insists on a stream anyway. So flattening costs a workaround AND a worse result.
 */
