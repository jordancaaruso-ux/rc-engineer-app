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
import { orderedFieldWidgets } from "@/lib/setupDocuments/pdfFormFields";

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
 * Draw every text value into the file with a standard font, for readers that show only what is
 * already drawn.
 *
 * The field's own instructions are put back afterwards. pdf-lib rewrites them to name the font it
 * just used, which would leave a viewer that redraws — Acrobat, with `NeedAppearances` set — using
 * plain Helvetica instead of the manufacturer's Verdana Italic. Restoring them costs nothing and
 * keeps the good case good.
 */
async function bakeTextAppearances(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>
): Promise<void> {
  let font: Awaited<ReturnType<PDFDocument["embedFont"]>> | null = null;
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    if (!field.getText()) continue;
    try {
      font ??= await pdfDoc.embedFont(StandardFonts.Helvetica);
      const originalDa = field.acroField.getDefaultAppearance();
      field.defaultUpdateAppearances(font);
      if (originalDa) field.acroField.setDefaultAppearance(originalDa);
    } catch {
      // A field pdf-lib cannot draw still carries its value; a viewer that redraws will show it.
    }
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

    for (const e of filled) skipped.push(`${e.key}: "${name}" is a ${field.constructor.name}`);
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
  await bakeTextAppearances(pdfDoc, form);
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { bytes, written, skipped, conflicts };
}
