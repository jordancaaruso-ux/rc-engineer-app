/**
 * How a PDF says its own form fields should look when they are filled in.
 *
 * WHY THIS EXISTS. Drivers know what a filled setup sheet looks like, because they fill them in
 * Acrobat. If the app draws values in its own font and colour the sheet stops looking like their
 * sheet, and a printed or exported copy gives the game away. So none of this is invented: every
 * PDF form field carries a default appearance string saying which font, size and colour a viewer
 * must draw its value in, and every tick box carries the glyph it ticks with.
 *
 * MEASURED ON THE THREE BLANKS IN THE REPO (2026-08-10), which is why guessing was never going to
 * work — no two agree, and none of them is plain black on white:
 *
 *   Xray X4 '26   values RED Helvetica, 95% centred   · ticks are a CROSS (131), circle (41), square (10)
 *   Xray X4 '22   values NAVY Verdana Italic, mixed   · ticks are a check (98), circle (32), square (16)
 *   Mugen MTC3    values NAVY Verdana Italic, left    · ticks are a circle (81), check (25)
 *
 * A size of 0 means auto: the viewer picks a size that fits the box. That is left as 0 here and
 * decided where the box's drawn height is actually known.
 */

import { zapfMarkForCharacter, type ZapfMarkPlacement } from "@/lib/setupDocuments/zapfDingbatMarks";

export type PdfTextAlignment = "left" | "center" | "right";

export type PdfFieldAppearance = {
  /** A CSS font stack, closest match to the font the PDF names. */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Points. **0 means auto** — size it to the box, the way a viewer does. */
  fontSize: number;
  /** `#rrggbb`. */
  color: string;
  alignment: PdfTextAlignment;
  multiline: boolean;
};

export const DEFAULT_PDF_FIELD_APPEARANCE: PdfFieldAppearance = {
  fontFamily: "Helvetica, Arial, sans-serif",
  bold: false,
  italic: false,
  fontSize: 0,
  color: "#000000",
  alignment: "left",
  multiline: false,
};

/**
 * The abbreviations a PDF uses for the fourteen fonts every viewer must have.
 *
 * These are not font names anyone would recognise — `TiBI` is Times Bold Italic — so they are
 * spelled out rather than pattern-matched.
 */
const BASE_14: Record<string, { family: string; bold?: boolean; italic?: boolean }> = {
  Helv: { family: "Helvetica" },
  HeBo: { family: "Helvetica", bold: true },
  HeOb: { family: "Helvetica", italic: true },
  HeBO: { family: "Helvetica", bold: true, italic: true },
  Cour: { family: "Courier" },
  CoBo: { family: "Courier", bold: true },
  CoOb: { family: "Courier", italic: true },
  CoBO: { family: "Courier", bold: true, italic: true },
  TiRo: { family: "Times" },
  TiBo: { family: "Times", bold: true },
  TiIt: { family: "Times", italic: true },
  TiBI: { family: "Times", bold: true, italic: true },
  Symb: { family: "Symbol" },
  ZaDb: { family: "ZapfDingbats" },
};

/** Families the browser will not have, mapped to the nearest stack it always does. */
const CSS_STACK: Record<string, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  Courier: "'Courier New', Courier, monospace",
  Times: "'Times New Roman', Times, serif",
  Verdana: "Verdana, Geneva, sans-serif",
  Tahoma: "Tahoma, Verdana, sans-serif",
  Calibri: "Calibri, Candara, sans-serif",
  Symbol: "Symbol, serif",
  ZapfDingbats: "'Zapf Dingbats', sans-serif",
};

function cssStackFor(family: string): string {
  const known = CSS_STACK[family];
  if (known) return known;
  // An embedded font nobody else has: name it first so it is used when it happens to be installed,
  // then fall back to a shape that at least matches its class.
  return `'${family.replace(/'/g, "")}', Helvetica, Arial, sans-serif`;
}

/**
 * `/ABCDEF+Verdana,BoldItalic` → Verdana, bold, italic.
 *
 * The six-letter prefix marks a font subset and says nothing about the face; the part after the
 * comma (or a `-` in some writers) is the style.
 */
export function parsePdfFontName(raw: string): { family: string; bold: boolean; italic: boolean } {
  const name = raw.replace(/^\//, "").replace(/^[A-Z]{6}\+/, "").trim();
  const base = BASE_14[name];
  if (base) {
    return { family: base.family, bold: Boolean(base.bold), italic: Boolean(base.italic) };
  }
  const [familyRaw, ...styleParts] = name.split(/[,]/);
  let family = (familyRaw ?? "").trim();
  let style = styleParts.join(" ");
  // `Verdana-BoldItalic` — same information, written with a hyphen.
  const hyphen = family.match(/^(.+?)-(Bold|Italic|Oblique|BoldItalic|BoldOblique)$/i);
  if (hyphen) {
    family = hyphen[1]!;
    style += ` ${hyphen[2]}`;
  }
  return {
    family: family || "Helvetica",
    bold: /bold/i.test(style),
    italic: /italic|oblique/i.test(style),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Read a default-appearance string: `/Helv 0 Tf 1 0 0 rg`.
 *
 * It is a fragment of PDF content-stream syntax, so operands come *before* their operator: `Tf`
 * takes the font and size in front of it, and the colour operator says how many numbers it took —
 * `g` one (grey), `rg` three (red green blue), `k` four (cyan magenta yellow black).
 */
export function parseDefaultAppearance(da: string | undefined | null): {
  fontName?: string;
  fontSize?: number;
  color?: string;
} {
  if (!da) return {};
  const tokens = da.trim().split(/\s+/);
  const out: { fontName?: string; fontSize?: number; color?: string } = {};

  for (let i = 0; i < tokens.length; i++) {
    const op = tokens[i];
    const num = (offset: number) => Number(tokens[i - offset]);

    if (op === "Tf" && i >= 2) {
      const size = num(1);
      const name = tokens[i - 2] ?? "";
      if (name.startsWith("/")) out.fontName = name.slice(1);
      if (Number.isFinite(size) && size >= 0) out.fontSize = size;
      continue;
    }
    if (op === "g" && i >= 1) {
      const v = num(1);
      if (Number.isFinite(v)) out.color = toHex(v, v, v);
      continue;
    }
    if (op === "rg" && i >= 3) {
      const [r, g, b] = [num(3), num(2), num(1)];
      if ([r, g, b].every(Number.isFinite)) out.color = toHex(r, g, b);
      continue;
    }
    if (op === "k" && i >= 4) {
      const [c, m, y, k] = [num(4), num(3), num(2), num(1)];
      if ([c, m, y, k].every(Number.isFinite)) {
        out.color = toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
      }
      continue;
    }
  }
  return out;
}

/**
 * The colour a tick box's ON picture actually paints its mark in.
 *
 * WHY THE DEFAULT-APPEARANCE STRING IS THE WRONG PLACE TO ASK. A tick box carries two descriptions
 * of itself: the `/DA` string, which says how a viewer should draw a value it types into the field,
 * and the `/AP /N` appearance stream, which is a little picture the PDF has already drawn of the box
 * ticked. Acrobat paints the picture; it never consults the `/DA` for a tick. Most sheets keep the
 * two in step, so reading the `/DA` looked right — but 4 of the 146 tick boxes on the Xray X4 '22
 * blank have an EMPTY `/DA` while their picture paints red, so the app drew those four in black
 * (measured 2026-08-14). Ask the picture.
 *
 * A content stream sets colour with the same operators as a `/DA`, operands first: `1 0 0 rg` fills
 * red, `0 g` fills black, `k` is CMYK, and the capitals (`RG`, `G`, `K`) set the STROKE colour for
 * outlined marks. Fill wins when both are present — a ZapfDingbats glyph is filled text.
 *
 * Returns undefined when the stream states no colour at all, which is a real answer: the mark then
 * inherits, and the field's own appearance is the right thing to fall back to.
 */
export function markColorFromAppearanceStream(stream: string | undefined | null): string | undefined {
  if (!stream) return undefined;
  const tokens = stream.split(/[\s\n\r]+/);
  let fill: string | undefined;
  let stroke: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const op = tokens[i];
    const num = (offset: number) => Number(tokens[i - offset]);
    const isFill = op === "g" || op === "rg" || op === "k";
    const isStroke = op === "G" || op === "RG" || op === "K";
    if (!isFill && !isStroke) continue;

    let color: string | undefined;
    const lower = op!.toLowerCase();
    if (lower === "g" && i >= 1) {
      const v = num(1);
      if (Number.isFinite(v)) color = toHex(v, v, v);
    } else if (lower === "rg" && i >= 3) {
      const [r, g, b] = [num(3), num(2), num(1)];
      if ([r, g, b].every(Number.isFinite)) color = toHex(r, g, b);
    } else if (lower === "k" && i >= 4) {
      const [c, m, y, kk] = [num(4), num(3), num(2), num(1)];
      if ([c, m, y, kk].every(Number.isFinite)) {
        color = toHex((1 - c) * (1 - kk), (1 - m) * (1 - kk), (1 - y) * (1 - kk));
      }
    }
    if (!color) continue;
    if (isFill) fill = color;
    else stroke = color;
  }

  return fill ?? stroke;
}

export function describePdfFieldAppearance(input: {
  /** The field's own default appearance, if it has one. */
  da?: string | null;
  /** The form's default appearance, used for fields that do not state their own. */
  formDa?: string | null;
  /** `/Q`: 0 left, 1 centre, 2 right. */
  quadding?: number | null;
  multiline?: boolean;
}): PdfFieldAppearance {
  const own = parseDefaultAppearance(input.da);
  const form = parseDefaultAppearance(input.formDa);
  const fontName = own.fontName ?? form.fontName;
  const font = fontName ? parsePdfFontName(fontName) : null;

  return {
    fontFamily: font ? cssStackFor(font.family) : DEFAULT_PDF_FIELD_APPEARANCE.fontFamily,
    bold: font?.bold ?? false,
    italic: font?.italic ?? false,
    fontSize: own.fontSize ?? form.fontSize ?? 0,
    color: own.color ?? form.color ?? DEFAULT_PDF_FIELD_APPEARANCE.color,
    alignment: input.quadding === 1 ? "center" : input.quadding === 2 ? "right" : "left",
    multiline: Boolean(input.multiline),
  };
}

/**
 * The mark a tick box actually makes.
 *
 * A checkbox stores its mark as one ZapfDingbats character. Acrobat's six styles are a check, a
 * cross, a circle, a diamond, a square and a star, and sheets in the wild use all of them — the
 * Xray X4 '26 blank crosses 131 of its boxes and ticks none. Drawing a check mark everywhere would
 * be visibly not the sheet the driver knows.
 */
const DINGBAT_MARKS: Record<string, string> = {
  "4": "✔",
  "8": "✘",
  l: "●",
  n: "■",
  u: "◆",
  H: "★",
};

export const DEFAULT_CHECK_MARK = "✔";

export function checkMarkForCaption(caption: string | undefined | null): string {
  if (!caption) return DEFAULT_CHECK_MARK;
  return DINGBAT_MARKS[caption.trim()] ?? DEFAULT_CHECK_MARK;
}

/**
 * Where a tick box's ON picture puts its mark, read out of the picture itself.
 *
 * WHY THE CAPTION IS NOT ENOUGH. `/MK /CA` names the mark and says nothing about how big it is or
 * where it goes, so the app sized every mark to the box and centred it. That is not what the sheet
 * does. Measured across the three repo blanks (2026-08-14, 419 tick widgets): the A800RR draws a
 * 14pt glyph inside a 12.3pt box and lets a clip window cut the overflowing corner off, and its
 * shock-position boxes draw a 75pt glyph clipped to a 4.8pt-wide slot — which is why a "square"
 * mark prints there as a tall bar. Centring a box-sized glyph gets all three wrong.
 *
 * The picture is a content stream, so everything needed is stated in it: `Tf` the size, `Td` the
 * baseline, `re W n` the clip. Operands come before their operator, and `Td` is RELATIVE, so the
 * offsets add up — the Mugen blank writes `0.6241 1.6788 Td … 0 0 Td` and means the first one.
 * `Tm` sets the position outright and therefore restarts the sum.
 *
 * Returns undefined for a picture that states no glyph or an auto size, because there is then
 * nothing to place and the caller's own sizing is the honest answer.
 */
export function markPlacementFromAppearanceStream(input: {
  stream: string | undefined | null;
  /** The picture's `/BBox`, or the widget's rectangle when it declares none. */
  boxWidth: number;
  boxHeight: number;
}): ZapfMarkPlacement | undefined {
  const { stream, boxWidth, boxHeight } = input;
  if (!stream || !(boxWidth > 0) || !(boxHeight > 0)) return undefined;

  const tokens = stream.split(/[\s\n\r]+/);
  const num = (i: number, back: number) => Number(tokens[i - back]);

  let size: number | undefined;
  let x = 0;
  let y = 0;
  let clip: [number, number, number, number] | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const op = tokens[i];
    if (op === "Tf" && i >= 2) {
      const s = num(i, 1);
      if (Number.isFinite(s)) size = s;
      continue;
    }
    // `Td` and `TD` both move to the start of the next line, by an offset from the current one.
    if ((op === "Td" || op === "TD") && i >= 2) {
      const dx = num(i, 2);
      const dy = num(i, 1);
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        x += dx;
        y += dy;
      }
      continue;
    }
    // `Tm` replaces the matrix outright; its last two operands are the position.
    if (op === "Tm" && i >= 6) {
      const tx = num(i, 2);
      const ty = num(i, 1);
      if (Number.isFinite(tx) && Number.isFinite(ty)) {
        x = tx;
        y = ty;
      }
      continue;
    }
    // The clip window: `x y w h re W n`. Only a rectangle that is actually clipped with counts.
    if (op === "re" && i >= 4 && tokens[i + 1] === "W") {
      const r: number[] = [num(i, 4), num(i, 3), num(i, 2), num(i, 1)];
      if (r.every(Number.isFinite) && r[2]! > 0 && r[3]! > 0) {
        clip = [r[0]!, r[1]!, r[2]!, r[3]!];
      }
      continue;
    }
  }

  const box = { boxWidth, boxHeight, ...(clip ? { clip } : {}) };

  const glyph = zapfMarkForCharacter(drawnGlyphCharacter(stream));
  // `0 Tf` is "size it to the box", a decision the viewer makes that this cannot reproduce.
  if (glyph && size && size > 0) {
    return { ...box, kind: "glyph", glyph, size, x, y };
  }

  const d = markPathFromAppearanceStream(stream);
  if (d) return { ...box, kind: "path", d };

  return undefined;
}

/**
 * The outline a tick box draws for itself, as SVG path data in the box's own points.
 *
 * WHY THIS EXISTS AT ALL. Not every sheet spells its tick as a character. 3,924 of the 13,694 tick
 * boxes measured across the repo blanks and 25 real driver uploads draw the mark curve by curve
 * instead, with no font in the picture — and the A800RR in production does BOTH, 90 boxes as text
 * and 77 as outlines, which is why half of its ticks came out as a fallback until this was written.
 *
 * The vocabulary those streams use is tiny and, measured over all 3,924, closed: `m` `l` `c` and
 * `f`, wrapped in `q`/`Q` pairs that never carry a `cm` — so there is no transform stack to keep,
 * and the operators map one for one onto SVG's `M` `L` `C` and an implicit close. Anything outside
 * that set is refused rather than half-drawn: `undefined` costs the box its exact outline and falls
 * back to the mark it names, which is where this started and is never worse.
 *
 * Coordinates stay in PDF space (y up). The renderer flips once, for the whole mark.
 */
export function markPathFromAppearanceStream(stream: string | undefined | null): string | undefined {
  if (!stream) return undefined;
  const tokens = stream.split(/[\s\n\r]+/).filter(Boolean);
  const operands: number[] = [];
  const parts: string[] = [];
  let painted = false;

  const round = (n: number) => Number(n.toFixed(3));

  for (const token of tokens) {
    const asNumber = Number(token);
    if (Number.isFinite(asNumber) && /^[-+.\d]/.test(token)) {
      operands.push(asNumber);
      continue;
    }
    // Names and arrays are operands too — `/GS0 gs`, `[] 0 d`. They carry no geometry, and they
    // must not clear what the numbers before them are for.
    if (/^[/[\]]/.test(token)) continue;
    switch (token) {
      case "m":
        if (operands.length < 2) return undefined;
        parts.push(`M${round(operands.at(-2)!)} ${round(operands.at(-1)!)}`);
        break;
      case "l":
        if (operands.length < 2) return undefined;
        parts.push(`L${round(operands.at(-2)!)} ${round(operands.at(-1)!)}`);
        break;
      case "c": {
        if (operands.length < 6) return undefined;
        const c = operands.slice(-6).map(round);
        parts.push(`C${c[0]} ${c[1]} ${c[2]} ${c[3]} ${c[4]} ${c[5]}`);
        break;
      }
      case "h":
        parts.push("Z");
        break;
      case "re": {
        if (operands.length < 4) return undefined;
        const [x, y, w, h] = operands.slice(-4).map(round);
        parts.push(`M${x} ${y}L${x! + w!} ${y}L${x! + w!} ${y! + h!}L${x} ${y! + h!}Z`);
        break;
      }
      // `f` closes every subpath and fills with the non-zero rule, which is SVG's default.
      case "f":
      case "F":
      case "f*":
        painted = true;
        parts.push("Z");
        break;
      // Colour, graphics state and the empty save/restore pairs these streams open with: no effect
      // on the shape, and the colour is read separately by `markColorFromAppearanceStream`.
      case "q":
      case "Q":
      case "n":
      case "W":
      case "W*":
      case "rg":
      case "g":
      case "k":
      case "RG":
      case "G":
      case "K":
      case "w":
      case "d":
      case "i":
      case "j":
      case "J":
      case "M":
      case "gs":
      case "cs":
      case "CS":
      case "sc":
      case "scn":
      case "SC":
      case "SCN":
        break;
      default:
        // An operator this has never seen could mean anything — a transform, a nested form, text.
        // Drawing what is understood and ignoring the rest would put a wrong mark on the paper.
        return undefined;
    }
    operands.length = 0;
  }

  if (!painted || parts.length === 0) return undefined;
  return parts.join("");
}

/**
 * The character the picture actually draws — `(4) Tj`.
 *
 * Asked of the picture rather than of `/MK /CA` because the picture is what a viewer paints. The
 * caption is a note about what the box is FOR; a sheet whose two disagree draws what the picture
 * says, and a sheet whose caption is missing or is a style this app has never seen still draws
 * something, instead of quietly falling back to a check mark.
 */
export function drawnGlyphCharacter(stream: string | undefined | null): string | undefined {
  if (!stream) return undefined;
  let last: string | undefined;
  // A literal string, then `Tj`. `\(` and `\)` are escaped inside, so they cannot end it early.
  for (const m of stream.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    const text = (m[1] ?? "").replace(/\\(.)/g, "$1");
    if (text) last = text;
  }
  return last;
}
