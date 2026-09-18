/**
 * Which boxes on a setup sheet hold prose, and how prose is sized in them.
 *
 * ============================== WHY THIS IS ITS OWN FILE ==============================
 *
 * Three places have to agree about it or a driver sees three different sheets: the fill/read
 * surface that draws values over the page picture, the changed-box crop on a run, and the export
 * that writes the values back into the manufacturer's own blank. They disagreed before — the
 * surface drew a note on one line with its end cut off while the exported PDF wrapped it properly
 * (founder, 2026-09-18: "the comments will often just be one line so the end of it will be
 * invisible… it needs to fill like it would from the actual PDF"). The rule lives here now, once.
 *
 * Nothing in here touches a PDF or the DOM: it is arithmetic over numbers every box already
 * carries, so the server, the browser and the export can all ask the same question.
 */

/**
 * The safety net for a blank that never says its notes box is a notes box.
 *
 * A wrapping box is supposed to announce itself: a PDF text field carries a multiline bit, read in
 * `pdfFormFields` and carried to the surface as `SheetFillBoxStyle.multiline`. Plenty of
 * manufacturers never set it — a big comments box is left as an ordinary single-line field that
 * their own viewer happens to scroll — and one of those would go back to being a line of prose
 * with its end cut off.
 *
 * MEASURED on the A800RR's 111 text widgets (2026-09-18): the tallest single-line box is 0.0210 of
 * the page, 17.7pt, and its one flagged comments box is 0.0933, 78.6pt — 4.4x taller. The threshold
 * sits between them with room on both sides, at about two and a half ordinary lines. No setup VALUE
 * needs a box that tall; only prose does.
 */
export const WRAP_HEIGHT_PAGE_FRAC = 0.035;

/**
 * A note box is not sized to its height — it wraps.
 *
 * The A800RR's comments box is 78.6pt tall and the viewer that filled it drew 11pt in it, a ratio
 * of 0.14: a multiline field gets a comfortable reading size and as many lines as it needs, not one
 * enormous line. Applying the ordinary height ratio there produced text five times too big, and
 * capping it by width on one imaginary line produced text half the size it should be.
 *
 * So a wrapping box is capped at a share of the PAGE height rather than its own — 11pt on that
 * sheet's 842pt page is 0.0131, and the cap sits just above it. Fitted to one real sample, which is
 * one more than the number it replaced had; Acrobat's multiline rule is not published.
 */
export const NOTE_SIZE_PAGE_FRAC = 0.0143;

/** Line box as a share of font size — ordinary text leading, used when wrapping. */
export const NOTE_LINE_HEIGHT = 1.15;

/**
 * Does this box hold prose — several lines, wrapped — rather than one value?
 *
 * `heightFracOfPage` is the box's height as a share of the page, which is how every box is stored,
 * so the answer never moves with zoom, screen size or how big the page has been drawn.
 */
export function boxWrapsText(input: {
  heightFracOfPage: number;
  /** The PDF said so itself. Believed whatever the shape is. */
  multiline?: boolean;
  /** A tick box is a mark, not text, however big its widget is. */
  isTick?: boolean;
}): boolean {
  if (input.isTick) return false;
  return Boolean(input.multiline) || input.heightFracOfPage >= WRAP_HEIGHT_PAGE_FRAC;
}
