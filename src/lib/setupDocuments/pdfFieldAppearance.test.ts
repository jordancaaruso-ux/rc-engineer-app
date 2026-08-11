import assert from "node:assert/strict";
import {
  checkMarkForCaption,
  describePdfFieldAppearance,
  parseDefaultAppearance,
  parsePdfFontName,
} from "@/lib/setupDocuments/pdfFieldAppearance";

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

console.log("pdfFieldAppearance.test.ts ok");
