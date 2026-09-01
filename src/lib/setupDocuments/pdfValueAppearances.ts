import "server-only";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { parseDefaultAppearance, parsePdfFontName } from "@/lib/setupDocuments/pdfFieldAppearance";

/**
 * ======================= ONE ENGINE THAT DRAWS A DRIVER'S VALUES =======================
 *
 * Every value on an exported sheet is drawn here, on every chassis, by the same rule the app draws
 * it with on screen. That is the point of the module: not "make the Awesomatix look right", but
 * "stop the export and the screen being two different pieces of software" (founder, 2026-09-01:
 * "this was not a 'fix the problems we have with current cars', it's a 'fix the fundamental way we
 * write PDFs'").
 *
 * ## What used to happen, and why it was per-car by accident
 *
 * The export handed each field to pdf-lib's own appearance generator with a base-14 substitute
 * font. That generator picks its own size, and — the part that did the real damage — REWRITES the
 * field's and the widget's `/DA`, the one line that says how the sheet wants its values drawn. On
 * the Awesomatix blanks it replaced `/Verdana,Italic 0 Tf 1 0 0 rg` (auto-size) with
 * `/Helvetica 10 Tf` (fixed), so the paper came back upright, in the wrong metrics, and clipped —
 * `7.4643` printed as `4643`. On the Xray blanks, whose fields name the standard `/Helv`, the font
 * was already right and only the SIZE was wrong, which is why the same bug looked like a different
 * bug on a different car.
 *
 * ## What happens now
 *
 * The appearance stream is written by hand, in the widget's own coordinate space, from three facts
 * the file states about itself: the font its `/DA` names, the colour its `/DA` sets, and the
 * quadding its `/Q` gives. Two kinds of font are drawn, and the choice is made per field:
 *
 *  1. **A font the sheet embeds** (`/DR /Font` with a `FontFile`, and `/Widths` to measure with) —
 *     Verdana Italic on the Awesomatix, Mugen, Axon, ARC and Schumacher blanks. The stream points
 *     at the font object ALREADY IN THE FILE, so nothing is licensed, shipped or duplicated. This
 *     is also why there is no `fontkit` here: pdf-lib can only embed a font it parses itself, and
 *     it cannot reuse one that is already present.
 *  2. **A standard font** — the fourteen every reader has. A sheet naming `/Helv` (Xray) is asking
 *     for exactly this, so drawing it is not a substitution at all; a sheet naming a face it does
 *     NOT embed gets the nearest base-14 of the right class, which is the only honest answer left.
 *
 * Either way the SIZE is the app's rule: `0 Tf` means "as big as fits" — height first, then shrunk
 * until the whole value is inside the box — and a stated size is honoured but still shrunk when it
 * would overflow. Measured with the font's real advances, never an average.
 *
 * ## What it deliberately does not do
 *
 *  - **Flatten.** The fields stay fields ("sharing something editable is important", founder,
 *    2026-09-01). `NeedAppearances` stays on, so a viewer that redraws reads the same `/DA` this
 *    drew from, and the two agree instead of disagreeing.
 *  - **Touch tick boxes.** Their appearance is the manufacturer's own mark — Xray's cross, Mugen's
 *    bullet — and flipping which one shows is all that is wanted. See `fillPdfForm`.
 *  - **Wrap.** A multiline note box is a different problem (leading, line breaking, a size rule of
 *    its own) and is left to the caller's fallback rather than guessed at.
 */

/** Mirrors `AUTO_TEXT_HEIGHT_RATIO` in `SheetFillSurface` — fitted to real filled sheets. */
const AUTO_TEXT_HEIGHT_RATIO = 0.73;
/** Acrobat's own inset: the border, plus a point of air either side. */
const PADDING_PT = 1;
const MIN_SIZE_PT = 3;
/** Ascent/descent when a font descriptor states none, in 1000ths. */
const FALLBACK_ASCENT = 750;
const FALLBACK_DESCENT = -250;

/**
 * A face this module can actually draw with: something to measure text by, something to place a
 * baseline with, and a name the appearance stream can call it.
 */
type DrawFont = {
  /** The name used INSIDE the appearance stream's own resources — never the page's. */
  resourceName: string;
  ref: PDFRef;
  /** Advance of the whole string at 1pt, so a size can be solved for directly. */
  widthAt1pt: (text: string) => number;
  ascentAt: (size: number) => number;
  /** Negative, as PDF states it. */
  descentAt: (size: number) => number;
  /** The string operand, already encoded the way this font expects its bytes. */
  operand: (text: string) => string;
};

function numberFrom(dict: PDFDict | undefined, key: string): number | undefined {
  const v = dict?.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/**
 * The nearest of the fourteen fonts every PDF reader must have, to a font this sheet names.
 *
 * A sheet that names `/Helv` is not being substituted — that IS a standard font. A sheet that names
 * a face it does not carry (no `FontFile` anywhere in the file) cannot be drawn in that face by
 * anyone, so the closest base-14 of the right CLASS is the honest answer: serif stays serif, fixed
 * stays fixed, italic stays italic. Upright-vs-italic is the difference a driver actually notices.
 */
export function nearestStandardFont(fontName: string | undefined): StandardFonts {
  const { family, bold, italic } = parsePdfFontName(fontName ?? "Helv");
  const f = family.toLowerCase();
  if (f.includes("courier") || f.includes("mono") || f.includes("consol")) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  // Times covers the serif faces a setup sheet is likely to name — Times, Georgia, Garamond, Book.
  if (
    f.includes("times") ||
    f.includes("georgia") ||
    f.includes("garamond") ||
    f.includes("serif") ||
    f.includes("roman") ||
    f.includes("book") ||
    f.includes("minion")
  ) {
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

/* ------------------------------------------------------------------ fonts the sheet carries */

type SheetFontMetrics = {
  resourceName: string;
  ref: PDFRef;
  firstChar: number;
  widths: number[];
  missingWidth: number;
  ascent: number;
  descent: number;
};

/**
 * The fonts this form declares AND can be measured.
 *
 * A font without a `/Widths` array is not offered: there is no honest way to size or align text
 * with it, and a guess is exactly what this module exists to stop. Such a field falls to a standard
 * font, whose metrics are known.
 */
export function sheetOwnFonts(pdfDoc: PDFDocument): Map<string, SheetFontMetrics> {
  const out = new Map<string, SheetFontMetrics>();
  const acroForm = pdfDoc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return out;
  const dr = acroForm.lookup(PDFName.of("DR"));
  if (!(dr instanceof PDFDict)) return out;
  const fonts = dr.lookup(PDFName.of("Font"));
  if (!(fonts instanceof PDFDict)) return out;

  for (const [nameObj] of fonts.entries()) {
    const resourceName = nameObj.asString().replace(/^\//, "");
    // The REF, not the resolved dictionary: the appearance stream has to point at the same object,
    // or the viewer loads a second copy of a font that is already in the file.
    const ref = fonts.get(nameObj);
    if (!(ref instanceof PDFRef)) continue;
    const font = fonts.lookup(nameObj);
    if (!(font instanceof PDFDict)) continue;

    const widthsArray = font.lookup(PDFName.of("Widths"));
    if (!(widthsArray instanceof PDFArray)) continue;
    const widths: number[] = [];
    for (let i = 0; i < widthsArray.size(); i += 1) {
      const w = widthsArray.lookup(i);
      widths.push(w instanceof PDFNumber ? w.asNumber() : 0);
    }
    if (widths.length === 0) continue;

    const descriptor = font.lookup(PDFName.of("FontDescriptor"));
    const desc = descriptor instanceof PDFDict ? descriptor : undefined;
    out.set(resourceName, {
      resourceName,
      ref,
      firstChar: numberFrom(font, "FirstChar") ?? 0,
      widths,
      missingWidth: numberFrom(desc, "MissingWidth") ?? 500,
      ascent: numberFrom(desc, "Ascent") ?? FALLBACK_ASCENT,
      descent: numberFrom(desc, "Descent") ?? FALLBACK_DESCENT,
    });
  }
  return out;
}

/**
 * The bytes a simple font actually receives.
 *
 * These sheets are filled with numbers, latin words and the odd degree sign, all of which live in
 * WinAnsi's single-byte range. Anything outside it is folded to its plain equivalent or dropped
 * rather than mangled: a value the font cannot draw is not one this code should invent a glyph for.
 */
function encodeWinAnsi(text: string): number[] {
  const codes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0xff) codes.push(code);
    else if (ch === "–" || ch === "—") codes.push(0x2d);
    else if (ch === "‘" || ch === "’") codes.push(0x27);
    else if (ch === "“" || ch === "”") codes.push(0x22);
  }
  return codes;
}

function hexOperand(codes: number[]): string {
  return `<${codes.map((c) => c.toString(16).padStart(2, "0")).join("")}>`;
}

function sheetDrawFont(metrics: SheetFontMetrics): DrawFont {
  const advance = (code: number): number => {
    const i = code - metrics.firstChar;
    const w = i >= 0 && i < metrics.widths.length ? metrics.widths[i] : undefined;
    return typeof w === "number" && w > 0 ? w : metrics.missingWidth;
  };
  return {
    resourceName: metrics.resourceName,
    ref: metrics.ref,
    widthAt1pt: (text) => encodeWinAnsi(text).reduce((sum, c) => sum + advance(c), 0) / 1000,
    ascentAt: (size) => (metrics.ascent / 1000) * size,
    descentAt: (size) => (metrics.descent / 1000) * size,
    operand: (text) => hexOperand(encodeWinAnsi(text)),
  };
}

/**
 * A standard font as something this module can draw with.
 *
 * Ascent and descent are derived from pdf-lib's own measurements rather than a table: asking for
 * the height WITHOUT the descender gives the ascent, and the difference from the full height gives
 * the descender. No private fields, no second copy of the metrics to drift.
 */
function standardDrawFont(font: PDFFont, resourceName: string): DrawFont {
  return {
    resourceName,
    ref: font.ref,
    widthAt1pt: (text) => font.widthOfTextAtSize(text, 1),
    ascentAt: (size) => font.heightAtSize(size, { descender: false }),
    descentAt: (size) => font.heightAtSize(size, { descender: false }) - font.heightAtSize(size),
    operand: (text) => font.encodeText(text).toString(),
  };
}

/* -------------------------------------------------------------------------- the field itself */

/**
 * The colour operators to repeat verbatim, straight out of the `/DA`.
 *
 * The shared parser hands back a hex string, which is what the UI wants; a content stream wants the
 * operators the sheet actually wrote (`1 0 0 rg`), so they are lifted as text. The LAST fill wins,
 * which is how a viewer reads a sequence of them.
 */
function fillColorOperators(da: string | undefined): string | null {
  if (!da) return null;
  const re = /(-?[\d.]+(?:\s+-?[\d.]+){0,3})\s+(g|rg|k)(?![A-Za-z])/g;
  let last: string | null = null;
  for (let m = re.exec(da); m; m = re.exec(da)) {
    const operands = m[1]!.trim().split(/\s+/);
    const wanted = m[2] === "g" ? 1 : m[2] === "rg" ? 3 : 4;
    if (operands.length >= wanted) last = `${operands.slice(-wanted).join(" ")} ${m[2]}`;
  }
  return last;
}

function fieldTextOf(field: PDFTextField): string {
  const v = field.acroField.dict.lookup(PDFName.of("V"));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return field.getText() ?? "";
}

/** `/Ff` bit 13 — a note box wraps instead of shrinking, and is left to the caller's fallback. */
function isMultiline(field: PDFTextField): boolean {
  const ff = field.acroField.dict.lookup(PDFName.of("Ff"));
  return ff instanceof PDFNumber ? ((ff.asNumber() >> 12) & 1) === 1 : false;
}

/** `/Q` — 0 left, 1 centre, 2 right, inheritable from the field. */
function quadding(field: PDFTextField, widget: PDFDict): 0 | 1 | 2 {
  const own = widget.lookup(PDFName.of("Q"));
  const inherited = field.acroField.dict.lookup(PDFName.of("Q"));
  const q =
    own instanceof PDFNumber
      ? own.asNumber()
      : inherited instanceof PDFNumber
        ? inherited.asNumber()
        : 0;
  return q === 1 ? 1 : q === 2 ? 2 : 0;
}

function borderWidthOf(widget: PDFDict): number {
  const bs = widget.lookup(PDFName.of("BS"));
  const w = bs instanceof PDFDict ? numberFrom(bs, "W") : undefined;
  return typeof w === "number" ? w : 1;
}

export type ValueBakeResult = {
  /** Field names this drew, so the caller's fallback can skip them. */
  handled: Set<string>;
  /** Widgets drawn, and how — for the caller's diagnostics and the tests. */
  widgets: number;
  withSheetFont: number;
  withStandardFont: number;
};

/**
 * Draw every single-line text value, and report which fields are done.
 *
 * Only wrapping boxes are left behind. Everything else is drawn here whether or not the sheet
 * carries its own font — which is the whole difference between this and what it replaced.
 */
export async function bakeValueAppearances(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  formDa: string | undefined
): Promise<ValueBakeResult> {
  const sheetFonts = sheetOwnFonts(pdfDoc);
  const standards = new Map<StandardFonts, DrawFont>();
  const result: ValueBakeResult = {
    handled: new Set<string>(),
    widgets: 0,
    withSheetFont: 0,
    withStandardFont: 0,
  };

  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    const text = fieldTextOf(field).trim();
    if (!text) continue;
    if (isMultiline(field)) continue;

    const da = field.acroField.getDefaultAppearance() ?? formDa;
    const parsed = parseDefaultAppearance(da);

    // The sheet's own face when it carries one, else the standard font it is really asking for.
    const carried = parsed.fontName ? sheetFonts.get(parsed.fontName) : undefined;
    let drawFont: DrawFont;
    if (carried) {
      drawFont = sheetDrawFont(carried);
    } else {
      const standard = nearestStandardFont(parsed.fontName);
      let cached = standards.get(standard);
      if (!cached) {
        // Embedded once per face and reused: a sheet has one or two across two hundred fields.
        const embedded = await pdfDoc.embedFont(standard);
        cached = standardDrawFont(embedded, `AppF${standards.size}`);
        standards.set(standard, cached);
      }
      drawFont = cached;
    }

    const unitWidth = drawFont.widthAt1pt(text);
    if (!(unitWidth > 0)) continue;

    let drewOne = false;
    for (const widget of field.acroField.getWidgets()) {
      const dict = widget.dict;
      const rect = widget.getRectangle();
      const w = Math.abs(rect.width);
      const h = Math.abs(rect.height);
      if (w <= 0 || h <= 0) continue;

      const inset = borderWidthOf(dict) + PADDING_PT;
      const innerWidth = Math.max(w - inset * 2, 1);
      const innerHeight = Math.max(h - inset * 2, 1);

      /*
       * `0 Tf` is the sheet asking for "as big as fits". A STATED size is honoured, but still
       * shrunk when the value would run out of the box — which is what clipped `7.4643` to `4643`
       * once pdf-lib had rewritten these boxes to a fixed 10pt.
       */
      const stated = parsed.fontSize && parsed.fontSize > 0 ? parsed.fontSize : null;
      const byHeight = stated ?? innerHeight * AUTO_TEXT_HEIGHT_RATIO;
      const size = Math.max(Math.min(byHeight, innerWidth / unitWidth), MIN_SIZE_PT);

      const textWidth = unitWidth * size;
      const q = quadding(field, dict);
      const x =
        q === 1
          ? Math.max((w - textWidth) / 2, inset)
          : q === 2
            ? Math.max(w - inset - textWidth, inset)
            : inset;

      // Centre the line on the box the way a viewer does: by the font's own ascent and descent.
      const ascent = drawFont.ascentAt(size);
      const descent = drawFont.descentAt(size);
      const y = (h - (ascent - descent)) / 2 - descent;

      const colorOps = fillColorOperators(da) ?? "0 g";
      const stream = [
        "/Tx BMC",
        "q",
        `${inset} ${inset} ${Math.max(w - inset * 2, 0)} ${Math.max(h - inset * 2, 0)} re W n`,
        "BT",
        colorOps,
        `/${drawFont.resourceName} ${size.toFixed(2)} Tf`,
        `${x.toFixed(2)} ${y.toFixed(2)} Td`,
        `${drawFont.operand(text)} Tj`,
        "ET",
        "Q",
        "EMC",
      ].join("\n");

      const xobject = pdfDoc.context.stream(stream, {
        Type: PDFName.of("XObject"),
        Subtype: PDFName.of("Form"),
        FormType: 1,
        BBox: pdfDoc.context.obj([0, 0, w, h]),
        // The font object itself — the sheet's own where there is one, so nothing is duplicated.
        Resources: pdfDoc.context.obj({
          Font: pdfDoc.context.obj({ [drawFont.resourceName]: drawFont.ref }),
        }),
      });
      dict.set(PDFName.of("AP"), pdfDoc.context.obj({ N: pdfDoc.context.register(xobject) }));

      result.widgets += 1;
      if (carried) result.withSheetFont += 1;
      else result.withStandardFont += 1;
      drewOne = true;
    }

    if (drewOne) result.handled.add(field.getName());
  }

  return result;
}
