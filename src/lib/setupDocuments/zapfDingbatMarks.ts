/**
 * The six marks a PDF tick box can make, as outlines rather than as characters.
 *
 * ============================== WHY NOT JUST PRINT THE CHARACTER ==============================
 *
 * A tick box stores its mark as one ZapfDingbats character — `4` is the heavy check, `l` a filled
 * circle, `n` a filled square. Every PDF viewer has that font built in, so Acrobat draws the sheet's
 * own mark. A browser does not: `font-family: 'Zapf Dingbats'` resolves to nothing on Windows,
 * Android and most Linux, so the app printed the nearest UNICODE character (`✔` U+2714) in whatever
 * face the page happened to be using — Sora, here. That is a different shape: thinner, straighter,
 * and sized by the line box rather than by the sheet. Side by side with the driver's own Acrobat the
 * mark was visibly not the same mark.
 *
 * So the outlines are carried here instead. Each is the real glyph, traced from the same pdfjs
 * rendering path that draws the page picture behind the boxes, in the font's own 1000-unit em box
 * with y measured UP from the baseline — the coordinate space `Tf` and `Td` in an appearance stream
 * already speak. A polygon, not a font: nothing to download, nothing to fall back to, and it stays
 * sharp at any zoom.
 *
 * ACCURACY. Traced at 1000×1000 and simplified to a 2.5-unit tolerance, so no point sits further
 * than 2.5/1000 of an em from the real outline — a quarter of a pixel on a 100px mark, and these
 * draw at 10–40px. Areas check out against the shapes they should be: the square measures 39.2% of
 * the sample box against 39.5% exact, the circle 33.5% against π/4·722·719 = 33.7%, the diamond
 * 21.3% against 21.4%.
 */

/** The marks Acrobat offers in its tick-box style menu, by the name a human would use. */
export type ZapfMarkName = "check" | "cross" | "circle" | "square" | "diamond" | "star";

export type ZapfMark = {
  /** SVG path in the font's em box: 1000 units, y UP from the baseline. */
  d: string;
  /** Ink extents `[left, bottom, right, top]`, same units. */
  bbox: [number, number, number, number];
};

/**
 * The ZapfDingbats character each mark is stored as.
 *
 * Both directions are needed: reading a sheet asks "what does `l` mean", and the appearance stream
 * spells the mark with the same character its `/MK /CA` caption uses.
 */
export const ZAPF_MARK_BY_CHARACTER: Record<string, ZapfMarkName> = {
  "4": "check",
  "8": "cross",
  l: "circle",
  n: "square",
  u: "diamond",
  H: "star",
};

/**
 * The nearest Unicode character for each mark.
 *
 * The fallback, not the plan: it is what a sheet stored before the outlines existed still draws
 * with, and what a box whose picture auto-sizes its mark has to fall back to. Whichever font the
 * page is set in draws these, so they are close rather than right — which is the whole reason the
 * outlines above exist.
 */
export const UNICODE_FOR_ZAPF_MARK: Record<ZapfMarkName, string> = {
  check: "✔",
  cross: "✘",
  circle: "●",
  square: "■",
  diamond: "◆",
  star: "★",
};

export const ZAPF_MARKS: Record<ZapfMarkName, ZapfMark> = {
  check: {
    bbox: [36, -14, 811, 705],
    d: "M770 705L800 703L809 693L810 594L804 576L330 88L246 16L201-12L186-13L163-7L122 15L73 56L56 85L38 251L36 377L46 403L83 447L106 469L133 481L179 485L197 480L208 472L217 451L220 410L241 290L255 266L266 260L278 259L328 302L518 488L739 691L757 702L769 704Z",
  },
  cross: {
    bbox: [36, -13, 642, 705],
    d: "M556 705L589 699L602 692L598 675L603 655L609 647L620 647L626 641L641 606L638 589L631 578L510 460L410 346L558 163L556 151L537 117L527 108L517 108L509 99L505 77L480 57L450 75L418 44L411 41L401 43L369 79L288 192L139-8L135-12L123-12L104 8L107 24L103 28L75 21L64 31L42 65L40 73L51 89L52 99L36 136L203 334L133 473L91 582L87 597L109 627L123 640L142 622L148 621L156 627L159 646L166 657L180 664L192 662L324 470L434 587L555 704Z",
  },
  circle: {
    bbox: [35, -14, 757, 705],
    d: "M378 705L430 704L487 694L539 676L577 657L628 621L666 584L702 536L725 493L743 444L753 396L756 328L752 290L740 239L720 189L693 143L661 103L631 74L594 46L560 26L513 6L430-12L378-13L339-9L298 0L255 15L215 35L180 58L153 80L111 125L67 197L42 273L36 314L35 365L40 409L50 451L69 500L90 538L144 604L211 655L248 674L291 690L339 701L377 704Z",
  },
  square: {
    bbox: [35, 0, 726, 692],
    d: "M35 692L725 692L725 1L35 1L35 691Z",
  },
  diamond: {
    bbox: [35, -14, 754, 705],
    d: "M393 705L753 346L393-13L35 346L392 704Z",
  },
  star: {
    bbox: [36, -14, 781, 703],
    d: "M407 703L493 436L780 436L549 263L639-13L408 156L178-12L269 263L36 436L321 436L407 702Z",
  },
};

/** The mark a caption names, or nothing when it names none of them. */
export function zapfMarkForCharacter(character: string | undefined | null): ZapfMarkName | undefined {
  if (!character) return undefined;
  return ZAPF_MARK_BY_CHARACTER[character.trim()];
}

/**
 * Where a mark sits inside its box, in the box's OWN points, exactly as the PDF states it.
 *
 * Measured on all three repo blanks plus 25 real driver uploads (2026-08-14): a tick box's
 * appearance box is the widget rectangle itself — `/BBox [0 0 w h]` with an identity `/Matrix`,
 * 13,694 of 13,694 widgets — so these coordinates are the box's own, origin at its bottom-left,
 * y UP.
 *
 * ============================== TWO WAYS A SHEET DRAWS A TICK ==============================
 *
 * Counted over the same files: 9,770 tick boxes draw their mark as TEXT — a ZapfDingbats character
 * at a stated size and position — and 3,924 draw it as an explicit OUTLINE, curve by curve, with no
 * font involved at all. The A800RR in production is 90 of the first kind and 77 of the second, in
 * the same file, so a reading that only understood one of them would get half its sheet wrong.
 *
 *  - `kind: "glyph"` is the text one. `size` and `x`/`y` are the stream's `Tf` and `Td`, and the
 *    outline comes from {@link ZAPF_MARKS}.
 *  - `kind: "path"` is the drawn one, already in the box's points. Nothing is inferred: it is the
 *    sheet's own curves.
 *
 * `clip` is the stream's `re W n` window and is load-bearing rather than decorative: the A800RR
 * draws a 14pt mark in a 12.3pt box and lets the clip cut the corner off, and its shock-position
 * boxes draw a 75pt square through a 4.8pt-wide slot, which is why they print as a tall bar.
 */
export type ZapfMarkPlacement = {
  /** The box in its own points — the SVG viewBox. */
  boxWidth: number;
  boxHeight: number;
  /** `[x, y, width, height]` in those points, y up. Absent when the sheet clips nothing. */
  clip?: [number, number, number, number];
} & (
  | {
      kind: "glyph";
      glyph: ZapfMarkName;
      /** Em size of the glyph, in the box's points. */
      size: number;
      /** Baseline origin, in those points, y up from the box's bottom edge. */
      x: number;
      y: number;
    }
  | {
      kind: "path";
      /** SVG path data in the box's own points, y UP — the sheet's own outline. */
      d: string;
    }
);
