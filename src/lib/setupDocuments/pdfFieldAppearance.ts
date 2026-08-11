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
