import "server-only";

import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFObject,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

/**
 * The same PDF with every box emptied.
 *
 * ============================== WHY THIS IS NOT OPTIONAL ==============================
 *
 * The picture of a chassis's sheet is rendered from whichever PDF happened to create that chassis,
 * and it is then shared by every driver who runs that car. But the file that created it is very
 * often somebody's FINISHED sheet — that is the whole point of the single door, since nothing can
 * tell a blank from a filled one.
 *
 * Rendered as-is, the result is that the first uploader's setup is printed onto the background of
 * everyone else's sheet. Caught on screen 2026-08-11: the Mugen chassis came from Sören's finished
 * sheet, so his damper settings and his name sat under every other driver's boxes. Their own values
 * are drawn on top, which makes it worse rather than better — two numbers in one box, one of them
 * somebody else's.
 *
 * So the background is always a cleared form. What the driver's own file contained is not lost: it
 * was read into values at upload, and the app draws those in the boxes itself.
 *
 * A manufacturer's blank usually carries the kit settings as real field values, and this clears
 * those from the PICTURE too. That is correct for the same reason — the kit settings came back as
 * values, so they are drawn rather than printed, and the driver can change one and see it change.
 */
export async function blankPdfFormValues(
  bytes: Uint8Array,
  /**
   * Clear only these PDF field names, leaving the rest of the sheet printed as it is.
   *
   * For a file that is the DRIVER'S OWN upload rather than shared paper. There is no other
   * person's data in it to hide, so the only boxes worth clearing are the ones the app is about to
   * write — otherwise a box the driver emptied in the app would keep its old printed value, while a
   * box nobody maps would lose the driver's own last-known value for nothing. That second half is
   * not hypothetical: the engine this replaced whited out exactly the mapped widgets and no others,
   * so clearing everything here would silently blank ~109 boxes on an A800RR export.
   *
   * Omit it for shared paper (a chassis blank), where clearing everything is the entire point.
   */
  onlyFieldNames?: ReadonlySet<string>
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();

  for (const field of form.getFields()) {
    if (onlyFieldNames && !onlyFieldNames.has(field.getName())) continue;
    // Per field, because one field that refuses to clear must not leave the whole sheet showing
    // somebody's setup. A field that throws keeps its value; every other one is still emptied.
    try {
      if (field instanceof PDFTextField) field.setText("");
      else if (field instanceof PDFCheckBox) field.uncheck();
      else if (field instanceof PDFRadioGroup) field.clear();
      else if (field instanceof PDFDropdown) field.clear();
      else if (field instanceof PDFOptionList) field.clear();
    } catch {
      /* one stubborn field, not a reason to abandon the sheet */
    }
  }

  /*
   * `updateFieldAppearances` clears the drawn text — and REWRITES every field's and widget's `/DA`
   * to name the substitute font pdf-lib used, in the size it chose. On the A800RR blank that turned
   * 109 fields saying `/Verdana,Italic 0 Tf 1 0 0 rg` into `/Helvetica 10 Tf`, on the shared paper,
   * before a single value had been written. Everything downstream then inherited it: the export
   * drew upright Helvetica at a fixed 10pt where the sheet asks for auto-sized Verdana Italic, so a
   * downloaded sheet looked nothing like the one on screen and clipped `7.4643` to `4643` (founder,
   * 2026-09-01).
   *
   * The instruction is the SHEET'S, not ours. It is taken down before and put back after — the
   * clearing is what this function is for, and the rewrite was collateral.
   */
  const originalDa: Array<{ dict: PDFDict; da: PDFObject }> = [];
  for (const field of form.getFields()) {
    const fieldDa = field.acroField.dict.get(PDFName.of("DA"));
    if (fieldDa) originalDa.push({ dict: field.acroField.dict, da: fieldDa });
    for (const widget of field.acroField.getWidgets()) {
      const widgetDa = widget.dict.get(PDFName.of("DA"));
      if (widgetDa) originalDa.push({ dict: widget.dict, da: widgetDa });
    }
  }

  // Without this the file still says the boxes are empty while the drawn appearance streams keep
  // showing the old text — which is exactly the thing being fixed, just harder to notice.
  try {
    form.updateFieldAppearances();
  } catch {
    /* some fields need a font pdf-lib cannot supply; the values are cleared regardless */
  }

  for (const { dict, da } of originalDa) dict.set(PDFName.of("DA"), da);

  return pdf.save({ updateFieldAppearances: false });
}
