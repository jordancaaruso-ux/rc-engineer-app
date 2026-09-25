import "server-only";

import { shareCardFonts, type FontWeight } from "@/lib/share/shareFonts";

/**
 * How wide a line of Sora (or Barlow Condensed) is, read from the font's own advance widths.
 *
 * Satori lays out into a fixed box and clips what overflows, and it has no API that reports where
 * text ended up. A picture with a fixed size (the 9:16 story) therefore has to choose each
 * headline's size BEFORE drawing it: "Barton Park Raceway" at the size that suits "TFTR" runs off
 * the edge. Estimating from an average glyph width was the old habit and it is out by 10–20% on
 * short strings; the font's `hmtx` table is exact apart from kerning, which only ever tightens.
 */

type Weight = 400 | 500 | 600 | 700;
type Metrics = { upm: number; advance: (codePoint: number) => number };

const byFace = new Map<string, Metrics>();

/** The two TrueType tables a width needs: `cmap` (format 4) to find the glyph, `hmtx` for its advance. */
function parseMetrics(buf: Buffer): Metrics {
  const tableCount = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < tableCount; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString("ascii", rec, rec + 4)] = buf.readUInt32BE(rec + 8);
  }
  const upm = buf.readUInt16BE(tables.head! + 18);
  const hMetricCount = buf.readUInt16BE(tables.hhea! + 34);
  const hmtx = tables.hmtx!;

  const cmap = tables.cmap!;
  let sub = -1;
  for (let i = 0, n = buf.readUInt16BE(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    if (buf.readUInt16BE(rec) === 3 && buf.readUInt16BE(rec + 2) === 1) sub = cmap + buf.readUInt32BE(rec + 4);
  }
  const segX2 = sub >= 0 ? buf.readUInt16BE(sub + 6) : 0;
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;

  const glyphOf = (code: number): number => {
    if (sub < 0 || code > 0xffff) return 0;
    for (let i = 0; i < segX2 / 2; i++) {
      if (code > buf.readUInt16BE(ends + i * 2)) continue;
      const start = buf.readUInt16BE(starts + i * 2);
      if (code < start) return 0;
      const delta = buf.readInt16BE(deltas + i * 2);
      const ro = buf.readUInt16BE(rangeOffsets + i * 2);
      if (ro === 0) return (code + delta) & 0xffff;
      const g = buf.readUInt16BE(rangeOffsets + i * 2 + ro + (code - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  const cache = new Map<number, number>();
  return {
    upm,
    advance(code) {
      let w = cache.get(code);
      if (w == null) {
        const g = glyphOf(code);
        w = buf.readUInt16BE(hmtx + Math.min(g, hMetricCount - 1) * 4);
        cache.set(code, w);
      }
      return w;
    },
  };
}

function metrics(family: string, weight: FontWeight): Metrics {
  const key = `${family}:${weight}`;
  let m = byFace.get(key);
  if (!m) {
    const font = shareCardFonts().find((f) => f.name === family && f.weight === weight);
    if (!font) throw new Error(`${family} ${weight} is not bundled`);
    m = parseMetrics(font.data);
    byFace.set(key, m);
  }
  return m;
}

/** Width in px of `text` set in Sora at `fontSize`, with CSS `letter-spacing` in px. */
export function soraWidth(text: string, fontSize: number, weight: Weight, letterSpacing = 0): number {
  return textWidth("Sora", text, fontSize, weight, letterSpacing);
}

/** Width in px of `text` in any bundled face. */
export function textWidth(family: string, text: string, fontSize: number, weight: FontWeight, letterSpacing = 0): number {
  const m = metrics(family, weight);
  let units = 0;
  let count = 0;
  for (const ch of text) {
    units += m.advance(ch.codePointAt(0)!);
    count++;
  }
  return (units / m.upm) * fontSize + letterSpacing * count;
}

/**
 * The largest size, from `max` down to `min`, at which `text` fits `width` on one line.
 * `letterSpacingEm` scales with the size, as the design specifies it.
 */
export function fitSoraSize(
  text: string,
  width: number,
  opts: { max: number; min: number; weight: Weight; letterSpacingEm?: number }
): number {
  return fitTextSize("Sora", text, width, opts);
}

/** {@link fitSoraSize} for any bundled face. */
export function fitTextSize(
  family: string,
  text: string,
  width: number,
  opts: { max: number; min: number; weight: FontWeight; letterSpacingEm?: number }
): number {
  const perPx = textWidth(family, text, 1, opts.weight, opts.letterSpacingEm ?? 0);
  if (perPx <= 0) return opts.max;
  return Math.max(opts.min, Math.min(opts.max, Math.floor(width / perPx)));
}
