import assert from "node:assert/strict";
import {
  checkMarkForCaption,
  describePdfFieldAppearance,
  drawnGlyphCharacter,
  markColorFromAppearanceStream,
  markPlacementFromAppearanceStream,
  parseDefaultAppearance,
  parsePdfFontName,
} from "@/lib/setupDocuments/pdfFieldAppearance";
import { ZAPF_MARK_BY_CHARACTER, ZAPF_MARKS } from "@/lib/setupDocuments/zapfDingbatMarks";

// --- The three real blanks in the repo, as they actually read (measured 2026-08-10) ---
{
  // Xray X4 '26: red Helvetica, auto-sized.
  const x26 = parseDefaultAppearance("/Helv 0 Tf 1 0 0 rg");
  assert.equal(x26.fontName, "Helv");
  assert.equal(x26.fontSize, 0);
  assert.equal(x26.color, "#ff0000");

  // Xray X4 '22 and Mugen MTC3: navy Verdana Italic.
  const navy = parseDefaultAppearance("/Verdana,Italic 0 Tf 0 0 0.5 rg");
  assert.equal(navy.fontName, "Verdana,Italic");
  assert.equal(navy.color, "#000080");

  // The form-level default every one of them carries.
  const form = parseDefaultAppearance("/Helv 0 Tf 0 g ");
  assert.equal(form.color, "#000000");
}

// --- Operands come before their operator, and the colour operator says how many it took ---
{
  assert.equal(parseDefaultAppearance("0.5 g").color, "#808080");
  assert.equal(parseDefaultAppearance("1 1 1 rg").color, "#ffffff");
  // CMYK: pure cyan.
  assert.equal(parseDefaultAppearance("1 0 0 0 k").color, "#00ffff");
  // Nothing to read is not a crash.
  assert.deepEqual(parseDefaultAppearance(""), {});
  assert.deepEqual(parseDefaultAppearance(undefined), {});
  assert.deepEqual(parseDefaultAppearance("garbage"), {});
}

// --- Font names: base-14 abbreviations, subset prefixes, and styles written either way ---
{
  assert.deepEqual(parsePdfFontName("Helv"), { family: "Helvetica", bold: false, italic: false });
  assert.deepEqual(parsePdfFontName("TiBI"), { family: "Times", bold: true, italic: true });
  assert.deepEqual(parsePdfFontName("HeOb"), { family: "Helvetica", bold: false, italic: true });
  assert.deepEqual(parsePdfFontName("/Verdana,Italic"), { family: "Verdana", bold: false, italic: true });
  assert.deepEqual(parsePdfFontName("ABCDEF+Arial,BoldItalic"), { family: "Arial", bold: true, italic: true });
  assert.deepEqual(parsePdfFontName("Verdana-Bold"), { family: "Verdana", bold: true, italic: false });
}

// --- A field states its own look; whatever it leaves out comes from the form ---
{
  const own = describePdfFieldAppearance({
    da: "/Verdana,Italic 0 Tf 0 0 0.5 rg",
    formDa: "/Helv 0 Tf 0 g",
    quadding: 1,
  });
  assert.match(own.fontFamily, /Verdana/);
  assert.equal(own.italic, true);
  assert.equal(own.color, "#000080");
  assert.equal(own.alignment, "center");
  assert.equal(own.fontSize, 0, "0 means auto — sized to the box where the box is known");

  const inherited = describePdfFieldAppearance({ da: null, formDa: "/Helv 9 Tf 0 g", quadding: 2 });
  assert.match(inherited.fontFamily, /Helvetica/);
  assert.equal(inherited.fontSize, 9);
  assert.equal(inherited.alignment, "right");

  const nothing = describePdfFieldAppearance({});
  assert.equal(nothing.color, "#000000");
  assert.equal(nothing.alignment, "left");
}

// --- The mark a tick box makes is the sheet's choice, not always a check ---
// The Xray X4 '26 blank crosses 131 of its boxes and ticks none of them.
{
  assert.equal(checkMarkForCaption("4"), "✔");
  assert.equal(checkMarkForCaption("8"), "✘");
  assert.equal(checkMarkForCaption("l"), "●");
  assert.equal(checkMarkForCaption("n"), "■");
  assert.equal(checkMarkForCaption("u"), "◆");
  assert.equal(checkMarkForCaption("H"), "★");
  // An unknown or missing caption falls back to the one everybody recognises.
  assert.equal(checkMarkForCaption(undefined), "✔");
  assert.equal(checkMarkForCaption("?"), "✔");
}

// --- The mark's colour lives in the box's own ON picture, not its default-appearance string ---
// Measured 2026-08-14: 18 of the 434 tick widgets across the three repo blanks have a black or
// absent `/DA` while their picture paints red, and those 18 used to draw black.
{
  assert.equal(markColorFromAppearanceStream("q 1 0 0 rg BT /ZaDb 9 Tf (4) Tj ET Q"), "#ff0000");
  assert.equal(markColorFromAppearanceStream("0 g BT (8) Tj ET"), "#000000");
  // Fill wins over stroke — a ZapfDingbats mark is filled text.
  assert.equal(markColorFromAppearanceStream("0 0 1 RG 1 0 0 rg (4) Tj"), "#ff0000");
  // Stroke alone is still an answer, for a mark drawn as an outline.
  assert.equal(markColorFromAppearanceStream("0 1 0 RG 2 w 0 0 m 5 5 l S"), "#00ff00");
  // CMYK, and the last colour set is the one the mark ends up painted in.
  assert.equal(markColorFromAppearanceStream("0 1 1 0 k (4) Tj"), "#ff0000");
  assert.equal(markColorFromAppearanceStream("1 0 0 rg 0 0 1 rg (4) Tj"), "#0000ff");
  // No colour stated is a real answer: the caller falls back to the field's own appearance.
  assert.equal(markColorFromAppearanceStream("BT /ZaDb 9 Tf (4) Tj ET"), undefined);
  assert.equal(markColorFromAppearanceStream(""), undefined);
  assert.equal(markColorFromAppearanceStream(undefined), undefined);
}

// --- The mark's SHAPE also comes from the picture, not from the caption ---
{
  assert.equal(drawnGlyphCharacter("q 1 0 0 rg BT /ZaDb 14 Tf (4) Tj ET Q"), "4");
  assert.equal(drawnGlyphCharacter("BT (l) Tj ET"), "l");
  // A stream that draws twice means the last one; a stream that draws nothing says nothing.
  assert.equal(drawnGlyphCharacter("(4) Tj (n) Tj"), "n");
  assert.equal(drawnGlyphCharacter("q 0 0 10 10 re f Q"), undefined);
  assert.equal(drawnGlyphCharacter(undefined), undefined);
  // An escaped bracket inside the string does not end it early.
  assert.equal(drawnGlyphCharacter("(\\)) Tj"), ")");
}

// --- Where the mark goes: the sheet says, in the box's own points ---
{
  // The A800RR's own tick, as it is actually written (measured 2026-08-14).
  const a800 = markPlacementFromAppearanceStream({
    stream: "q 1 1 10.3196 10.3468 re W n 1 0 0 rg BT /ZaDb 14 Tf 0.2378 1.4345 Td 13.482 TL (4) Tj ET Q",
    boxWidth: 12.32,
    boxHeight: 12.35,
  });
  assert.equal(a800?.kind, "glyph");
  assert.ok(a800?.kind === "glyph");
  assert.equal(a800.glyph, "check");
  assert.equal(a800.size, 14, "a 14pt mark in a 12.35pt box — it overflows on purpose");
  assert.equal(a800.x, 0.2378);
  assert.equal(a800.y, 1.4345);
  assert.deepEqual(a800.clip, [1, 1, 10.3196, 10.3468]);

  // The Mugen writes a second, zero `Td`. They ADD UP, so the first one is still the answer.
  const mugen = markPlacementFromAppearanceStream({
    stream: "q 1 1 10.3221 10.8355 re W n 1 0 0 rg BT /ZaDb 14 Tf 0.6241 1.6788 Td 13.482 TL 0 0 Td (l) Tj ET Q",
    boxWidth: 12.32,
    boxHeight: 12.84,
  });
  assert.ok(mugen?.kind === "glyph");
  assert.equal(mugen.glyph, "circle");
  assert.equal(mugen.x, 0.6241);
  assert.equal(mugen.y, 1.6788);

  // `Tm` states the position outright, so it replaces whatever was accumulating.
  const withMatrix = markPlacementFromAppearanceStream({
    stream: "BT /ZaDb 9 Tf 5 5 Td 1 0 0 1 2 3 Tm (n) Tj ET",
    boxWidth: 10,
    boxHeight: 10,
  });
  assert.ok(withMatrix?.kind === "glyph");
  assert.equal(withMatrix.x, 2);
  assert.equal(withMatrix.y, 3);

  // A rectangle that is not clipped with is not a clip — it is a background or a border.
  const painted = markPlacementFromAppearanceStream({
    stream: "0.75 g 0 0 12 12 re f 1 1 10 10 re W n BT /ZaDb 9 Tf 1 2 Td (4) Tj ET",
    boxWidth: 12,
    boxHeight: 12,
  });
  assert.deepEqual(painted?.clip, [1, 1, 10, 10]);
}

// --- What cannot be placed says so, rather than being placed wrongly ---
{
  // `0 Tf` is "size it to the box" — a decision the viewer makes, which this cannot reproduce.
  assert.equal(
    markPlacementFromAppearanceStream({
      stream: "BT /ZaDb 0 Tf 1 1 Td (4) Tj ET",
      boxWidth: 12,
      boxHeight: 12,
    }),
    undefined
  );
  // A glyph with no outline here.
  assert.equal(
    markPlacementFromAppearanceStream({
      stream: "BT /ZaDb 9 Tf 1 1 Td (z) Tj ET",
      boxWidth: 12,
      boxHeight: 12,
    }),
    undefined
  );
  // Nothing to read, and a box with no size, are both non-answers rather than crashes.
  assert.equal(markPlacementFromAppearanceStream({ stream: "", boxWidth: 12, boxHeight: 12 }), undefined);
  assert.equal(
    markPlacementFromAppearanceStream({ stream: "BT /ZaDb 9 Tf (4) Tj ET", boxWidth: 0, boxHeight: 0 }),
    undefined
  );
}

// --- The outlines are the real glyphs, and every mark the app names has one ---
{
  for (const [character, name] of Object.entries(ZAPF_MARK_BY_CHARACTER)) {
    const mark = ZAPF_MARKS[name];
    assert.ok(mark, `${name} (${character}) has no outline`);
    assert.match(mark.d, /^M[-\d.]/, `${name}'s path does not start with a move`);
    assert.match(mark.d, /Z$/, `${name}'s path is not closed`);
    const [left, bottom, right, top] = mark.bbox;
    assert.ok(right > left && top > bottom, `${name}'s bounding box is inside out`);
    // Traced in the font's own 1000-unit em box, so nothing may wander far outside it.
    assert.ok(left >= -50 && right <= 1050 && bottom >= -100 && top <= 1000, `${name} is out of its em box`);
  }
  // Every one of Acrobat's six styles is covered — an unmapped one used to become a check mark.
  assert.deepEqual(Object.keys(ZAPF_MARKS).sort(), ["check", "circle", "cross", "diamond", "square", "star"]);
}

console.log("pdfFieldAppearance.test.ts ok");
