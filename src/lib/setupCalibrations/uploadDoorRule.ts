import {
  normalizeCalibrationData,
  type SetupSheetCalibrationData,
} from "@/lib/setupCalibrations/types";

/**
 * Does this calibration open the "upload a sheet you've filled in" door?
 *
 * ================== TWO QUESTIONS THAT HAD GROWN INTO ONE SWITCH ==================
 *
 * Founder call 2026-08-11. These are separate mechanisms and the app kept conflating them:
 *
 *  1. **Can the app use this sheet at all?** All it needs is an editable PDF whose boxes it can
 *     find. That is enough for the driver to fill their own sheet, upload a filled one, log runs
 *     against it, and see what changed between two runs. Not one box has to be named for any of
 *     that to work — the sheet prints its own caption beside every box.
 *  2. **Does the Engineer understand the sheet?** That needs a human to name the boxes. Until
 *     somebody has, the Engineer sees "box 47" and cannot reason about the setup at all.
 *
 * This module answers ONLY question 1. It used to be answered with the green light, which is the
 * answer to question 2 — so the Xray X4'26 was offered a greyed-out upload door despite having a
 * calibration built from its own PDF's form layer, which reads that sheet exactly.
 *
 * ========================== WHY THE JULY GATE CAN COME OFF ==========================
 *
 * The green light was put on this door on 2026-07-22 because a *hand-authored* calibration guesses
 * which box on the paper means which parameter, gets some of them wrong, and "a partially-read
 * setup is worse than none" (SETUP_UPLOAD_NORTH_STAR round 3). That held while a read was
 * invisible — a list of values with no way to see what had been missed.
 *
 * It is no longer invisible. What was read lands on a picture of the driver's own sheet, where an
 * empty box is a visibly empty box. A partial read became something the driver can see and fix,
 * rather than a silent wrong answer.
 *
 * ======================== WHY THE GREEN LIGHT IS NOT AN ALTERNATIVE ========================
 *
 * An earlier pass at this let a green-lit IMAGE calibration open the door too, on the grounds that
 * a verified image map really can read a photo. It cannot get one: no image sheets are accepted
 * anywhere any more (founder, 2026-08-11 — `SETUP_DOCUMENT_ALLOWED_MIME` is PDF-only and the
 * flat-PDF raster bridge in `quick-create` is gone). A door that opens onto a file type the next
 * screen refuses is worse than a closed one, so the rule is the single test below.
 *
 * Note this is NOT the wrong-file guard. Uploading the wrong sheet is caught separately and more
 * strictly, by fingerprinting the PDF's form-field names against known calibrations — see
 * `fingerprintPick.ts`. This only decides whether the door is offered at all.
 */

/**
 * True when this calibration can read an editable PDF: it holds a mapping from the sheet's own
 * form-field names to parameters. A derived chassis gets one at upload; a hand-mapped one builds
 * it a box at a time. Either way the box names come from the file, so reading a filled copy of
 * that same file is reading the file's own answers back.
 */
export function calibrationReadsEditablePdf(data: SetupSheetCalibrationData): boolean {
  return Object.keys(data.formFieldMappings ?? {}).length > 0;
}

/** The whole rule. Pure, so it is testable without a database. */
export function calibrationOpensUploadDoor(calibrationDataJson: unknown): boolean {
  return calibrationReadsEditablePdf(normalizeCalibrationData(calibrationDataJson));
}
