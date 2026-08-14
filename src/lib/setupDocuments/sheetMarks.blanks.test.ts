/**
 * Every tick box on a real sheet must say where its mark goes — and a filled sheet must come back
 * looking like the sheet.
 *
 * WHAT THIS PINS. Until 2026-08-14 the app drew a tick as the nearest Unicode character in the
 * page's own font, centred and sized to a share of the box. That is three separate departures from
 * what the driver sees in Acrobat: the wrong outline, the wrong size, and no clip — so the A800RR's
 * shock-position boxes, which draw a 75pt glyph through a 4.8pt slot, printed as a small square
 * rather than the tall red bar on the paper. Measured against a pdfjs rendering of the same boxes,
 * the outlines now agree to 98.7–100% of their inked pixels at 24× magnification.
 *
 * Counts are what these files actually hold. A change that makes the reading *look* right still has
 * to agree with three real sheets.
 *
 *   node --conditions=react-server --import tsx src/lib/setupDocuments/sheetMarks.blanks.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFTextField, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { fillPdfForm } from "@/lib/setupDocuments/fillPdfForm";
import { ZAPF_MARKS } from "@/lib/setupDocuments/zapfDingbatMarks";

/** Blank → the marks it makes, counted per glyph. Measured 2026-08-14. */
const EXPECTED: Record<string, { path: string; ticks: number; glyphs: Record<string, number> }> = {
  "Awesomatix A800RR": {
    path: "public/setup-sheets/A800RR.pdf",
    ticks: 167,
    glyphs: { check: 117, circle: 34, square: 16 },
  },
  "Mugen MTC3": {
    path: "scripts/setup-extract-eval/gold/mugen-mtc3/files/MTC3_EditableSetupSheet_CW.pdf",
    ticks: 106,
    glyphs: { circle: 81, check: 25 },
  },
  "Xray X4 '22": {
    path: "scripts/setup-extract-eval/gold/xray-x4-2022/files/X42022_blank.pdf",
    ticks: 146,
    glyphs: { check: 98, circle: 32, square: 16 },
  },
};

async function marksAreRead() {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const extraction = await extractPdfFormFields(readFileSync(join(process.cwd(), expected.path)));
    const glyphs: Record<string, number> = {};
    let ticks = 0;
    let placed = 0;

    for (const field of extraction.fields) {
      for (const widget of field.widgets) {
        // `checked` is defined exactly on the widgets that can be ticked.
        if (widget.checked === undefined) continue;
        ticks += 1;
        const placement = widget.markPlacement;
        if (!placement) continue;
        placed += 1;
        const shape = placement.kind === "glyph" ? placement.glyph : "drawn";
        glyphs[shape] = (glyphs[shape] ?? 0) + 1;

        // The placement is only meaningful in the box's own space, so it has to be inside it.
        assert.ok(placement.boxWidth > 0 && placement.boxHeight > 0, `${name}: mark box has no size`);
        if (placement.kind === "glyph") {
          assert.ok(placement.size > 0, `${name}: a placed mark must have a stated size`);
          assert.ok(ZAPF_MARKS[placement.glyph], `${name}: ${placement.glyph} has no outline`);
        } else {
          assert.match(placement.d, /^M[-\d.]/, `${name}: a drawn mark must start with a move`);
        }
        if (placement.clip) {
          const [cx, cy, cw, ch] = placement.clip;
          assert.ok(cw > 0 && ch > 0, `${name}: clip window has no area`);
          assert.ok(
            cx >= -1 && cy >= -1 && cx + cw <= placement.boxWidth + 1 && cy + ch <= placement.boxHeight + 1,
            `${name}: clip window falls outside the box`
          );
        }
      }
    }

    assert.equal(ticks, expected.ticks, `${name}: tick widget count`);
    assert.equal(placed, expected.ticks, `${name}: every tick box must say where its mark goes`);
    assert.deepEqual(glyphs, expected.glyphs, `${name}: marks by shape`);
    console.log(`  ${name}: ${placed}/${ticks} placed · ${JSON.stringify(glyphs)}`);
  }
}

/**
 * The exported PDF draws its values in the CLASS of face the sheet asks for.
 *
 * Acrobat re-draws from the field's own instructions, so it was always right there. Preview,
 * Chrome's viewer and iOS Quick Look ignore `NeedAppearances` and show only what is baked in — and
 * what was baked in was Helvetica for every sheet, so a sheet printed in navy Verdana Italic came
 * back upright. Verdana is not ours to embed; the nearest standard oblique is.
 */
async function exportUsesTheSheetsFace() {
  const path = join(process.cwd(), "public/setup-sheets/A800RR.pdf");
  const blank = new Uint8Array(readFileSync(path));

  const probe = await PDFDocument.load(blank, { ignoreEncryption: true });
  const target = probe.getForm().getFields().find((f) => f instanceof PDFTextField) as PDFTextField;
  const originalDa = target.acroField.getDefaultAppearance();
  assert.match(originalDa ?? "", /Verdana,Italic/, "this blank is supposed to ask for Verdana Italic");

  const filled = await fillPdfForm({
    blank,
    mappings: { probe: { pdfFieldName: target.getName() } },
    values: { probe: "12.5" },
  });
  assert.equal(filled.written, 1);

  const out = await PDFDocument.load(filled.bytes, { ignoreEncryption: true });
  const field = out.getForm().getField(target.getName()) as PDFTextField;

  // The field's own instructions survive, so a viewer that redraws still uses the real face.
  assert.equal(field.acroField.getDefaultAppearance(), originalDa, "the sheet's own /DA was not restored");

  const widget = field.acroField.getWidgets()[0]!;
  const normal = (widget as unknown as { getAppearances?: () => { normal?: unknown } }).getAppearances?.()?.normal;
  assert.ok(normal instanceof PDFRawStream, "the value was not drawn into the file at all");
  const stream = Buffer.from(decodePDFRawStream(normal).decode()).toString("latin1");

  // pdf-lib writes the text as a hex string: `<31322E35> Tj` is "12.5".
  assert.match(stream, /<31322E35>\s*Tj/, "the value is not in the drawn appearance");
  assert.match(stream, /Oblique/, "an italic sheet must bake an italic face, not upright Helvetica");
  assert.match(stream, /1 0 0 rg/, "the sheet's own colour must survive into the drawing");
  console.log("  A800RR export: Verdana Italic → Helvetica-Oblique, red kept");
}

async function main() {
  await marksAreRead();
  await exportUsesTheSheetsFace();
  console.log("sheetMarks.blanks.test.ts ok");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
