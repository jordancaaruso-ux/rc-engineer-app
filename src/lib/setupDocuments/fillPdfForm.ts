import "server-only";

import {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { acroFieldTypeName, orderedFieldWidgets } from "@/lib/setupDocuments/pdfFormFields";
import { bakeValueAppearances, nearestStandardFont } from "@/lib/setupDocuments/pdfValueAppearances";
import { parseDefaultAppearance } from "@/lib/setupDocuments/pdfFieldAppearance";

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
 * The boxes the drawing engine leaves behind: the ones that WRAP.
 *
 * A note box is a different problem — leading, line breaking, and a size rule of its own — so it
 * still goes through pdf-lib's generator, which knows how to do all three. The cost is that the
 * generator rewrites the field's and the widget's `/DA` to name its own font at its own size, so
 * the sheet's instruction is taken down and put back afterwards. Restoring only the FIELD was the
 * original bug: a redrawing viewer reads the WIDGET's, and that one missed line is why an exported
 * sheet came back upright and clipped (founder, 2026-09-01).
 */
async function bakeWrappingBoxes(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  formDa: string | undefined,
  /** Fields the drawing engine has already handled — see `pdfValueAppearances`. */
  alreadyDrawn: ReadonlySet<string>
): Promise<void> {
  const embedded = new Map<StandardFonts, Awaited<ReturnType<PDFDocument["embedFont"]>>>();
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    if (!field.getText()) continue;
    if (alreadyDrawn.has(field.getName())) continue;
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
      if (originalDa) {
        field.acroField.setDefaultAppearance(originalDa);
        for (const widget of field.acroField.getWidgets()) {
          if (widget.dict.lookup(PDFName.of("DA"))) {
            widget.dict.set(PDFName.of("DA"), PDFString.of(originalDa));
          }
        }
      }
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
  const formDa = formDefaultAppearance(form);
  /*
   * The sheet's OWN font first. Where the blank embeds the face its fields ask for — Verdana
   * Italic on the Awesomatix blanks — the value is drawn in it, at the size the app uses, by
   * referencing the font object already in the file. Anything that leaves behind (a wrapping note
   * box, a sheet naming a font it does not embed) falls to the substitute below, which is what the
   * whole export used to be.
   */
  const drawn = await bakeValueAppearances(pdfDoc, form, formDa);
  await bakeWrappingBoxes(pdfDoc, form, formDa, drawn.handled);
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
