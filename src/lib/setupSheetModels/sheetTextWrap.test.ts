import assert from "node:assert/strict";
import {
  boxWrapsText,
  NOTE_LINE_HEIGHT,
  NOTE_SIZE_PAGE_FRAC,
  WRAP_HEIGHT_PAGE_FRAC,
} from "@/lib/setupSheetModels/sheetTextWrap";

/**
 * Measured off `public/setup-sheets/A800RR.pdf` on 2026-09-18 — 111 text widgets, one of which the
 * blank flags as multiline. These are the numbers the threshold was fitted between, so a change
 * that puts a real box on the wrong side of it fails here rather than on a driver's sheet.
 */
const A4_HEIGHT_PT = 841.9;
const TALLEST_SINGLE_LINE_PT = 17.7;
const COMMENTS_BOX_PT = 78.6;

const frac = (pt: number) => pt / A4_HEIGHT_PT;

// --- The shape rule, against the real sheet it was measured on --------------------------------
{
  assert.equal(
    boxWrapsText({ heightFracOfPage: frac(TALLEST_SINGLE_LINE_PT) }),
    false,
    "the tallest ordinary box on the A800RR is a value, not prose"
  );
  assert.equal(
    boxWrapsText({ heightFracOfPage: frac(COMMENTS_BOX_PT) }),
    true,
    "a comments box is prose on its shape alone, even from a blank that never flagged it"
  );

  // Room on both sides of the threshold, so neither number is sitting on the edge of it.
  assert.ok(
    frac(TALLEST_SINGLE_LINE_PT) < WRAP_HEIGHT_PAGE_FRAC * 0.75,
    "ordinary boxes clear the threshold with room to spare"
  );
  assert.ok(
    frac(COMMENTS_BOX_PT) > WRAP_HEIGHT_PAGE_FRAC * 1.5,
    "the comments box clears it with room to spare"
  );
}

// --- The flag always wins, whatever the shape says --------------------------------------------
{
  // Xray's sheet prints its comments on one short line and flags it. Believed.
  assert.equal(
    boxWrapsText({ heightFracOfPage: frac(12), multiline: true }),
    true,
    "a box that says it wraps wraps, however short it is"
  );
  // A mark is a mark. Some sheets draw a 75pt glyph through a tall slot — see `SheetMark`.
  assert.equal(
    boxWrapsText({ heightFracOfPage: frac(COMMENTS_BOX_PT), isTick: true }),
    false,
    "a tick box is never prose, however tall its widget is"
  );
  assert.equal(
    boxWrapsText({ heightFracOfPage: frac(COMMENTS_BOX_PT), multiline: true, isTick: true }),
    false,
    "and a flag does not turn a mark into text"
  );
}

// --- The size a note is drawn at --------------------------------------------------------------
{
  /*
   * A CAP, not the size: the caller shrinks from here until the wrapped text fits the box, so this
   * only has to sit just above the 11pt the viewer that filled the sample sheet committed to. Far
   * below it and every note is drawn small; far above and a short note is drawn as a banner.
   */
  const capPt = NOTE_SIZE_PAGE_FRAC * A4_HEIGHT_PT;
  assert.ok(
    capPt > 11 && capPt < 12.5,
    `the cap should sit just above the 11pt measured on the sample, got ${capPt.toFixed(2)}pt`
  );
  // And several lines of it fit the box it was measured in, which is the whole point of wrapping.
  const lines = Math.floor(COMMENTS_BOX_PT / (capPt * NOTE_LINE_HEIGHT));
  assert.ok(lines >= 5, `the comments box should hold five lines at the cap, got ${lines}`);
}

console.log("sheetTextWrap: ok");
