import "server-only";

import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
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
export async function blankPdfFormValues(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();

  for (const field of form.getFields()) {
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

  // Without this the file still says the boxes are empty while the drawn appearance streams keep
  // showing the old text — which is exactly the thing being fixed, just harder to notice.
  try {
    form.updateFieldAppearances();
  } catch {
    /* some fields need a font pdf-lib cannot supply; the values are cleared regardless */
  }

  return pdf.save({ updateFieldAppearances: false });
}
