/**
 * Build the briefing every naming helper reads for one sheet.
 *
 *   node scripts/setup-extract-eval/sheet-instructions.cjs <workDir> [--mode=blocks|boxes]
 *
 * Reads <workDir>/sheet.json and <workDir>/layout.md, writes <workDir>/instructions.md:
 * the naming rules (same for every sheet) + the drawing primer (naming-prompts/PRIMER.md) + this
 * sheet's layout briefing (written by the layout helper).
 *
 * mode=blocks (default when <workDir>/blocks/index.json exists): helpers name a whole block at once
 * from one tagged high-resolution picture. mode=boxes: one composite picture per box (v2).
 */
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) throw new Error("usage: sheet-instructions.cjs <workDir> [--mode=blocks|boxes]");
const modeArg = (process.argv.find((a) => a.startsWith("--mode=")) || "").slice(7);
const mode = modeArg || (fs.existsSync(path.join(dir, "blocks", "index.json")) ? "blocks" : "boxes");

const sheet = JSON.parse(fs.readFileSync(path.join(dir, "sheet.json"), "utf8"));
const layoutPath = path.join(dir, "layout.md");
if (!fs.existsSync(layoutPath)) throw new Error(`no layout.md in ${dir} — run the layout helper first`);
const layout = fs.readFileSync(layoutPath, "utf8");
const primer = fs.readFileSync(path.join(__dirname, "naming-prompts", "PRIMER.md"), "utf8");
const ids = (sheet.universalParameters || []).map((p) => p.id);

const pictures = mode === "blocks"
  ? `You name one BLOCK of the sheet at a time. Its picture is cut from a high-resolution render of the
whole block — the drawing and every box around it. Every box you must name is outlined in pink and
carries a pink tag with its number; a tick group's boxes are tagged 4.1, 4.2, … (the number after the
dot is k; that box's widgetIndex is k − 1). Tags and outlines are ours, not printed on the sheet. Each
box also has its own \`box\` picture (close-up, wider view, whole page with a crosshair) for when a tag
or a line is unclear.`
  : `For EACH field, Read its \`box\` picture. One picture holds three panels: a CLOSE-UP (the box
outlined in pink; a tick group's boxes are numbered 1, 2, 3… in pink — our numbers, not printed text),
a WIDER VIEW (same box, more of the sheet), and the WHOLE PAGE (pink marker and crosshair on this box).`;

const md = `# Naming the boxes of the ${sheet.name} blank setup sheet

You are naming the input boxes of a BLANK RC car setup sheet so that a driver's filled-in values can
be imported as real setup parameters.

${pictures}

## Rules that decide the name

- **Name what the box sets or measures**, the way a racer who owns this car would say it. For a box
  that prints only a generic word, follow its leader line to the part it lands on (the primer below
  says how, and what each shim position is called). A positional name ("top row, 2nd box") is a last
  resort with confidence 0.4 or less.
- **Which end of the car**: from the layout briefing, the drawing's orientation and where the box sits.
  A close-up lies — a rear hub looks like a front hub. The briefing's coordinates and its "Traps" section
  outrank your impression of a close-up.
- **The PDF's own field name** (the \`name\` in the JSON) sometimes carries the answer and sometimes lies.
  Where it names an end ("fr_", "re_", "rear_") and the picture agrees, use it. Where the print beside the
  box contradicts it, the PRINT wins; say so in \`printedLabel\`.
- **Never invent a value.** You are naming the empty box, not filling it in.

## What to return for each field

- \`name\`: echo the field name EXACTLY as given.
- \`printedLabel\`: the exact printed words on or beside the box ("" if none).
- \`displayLabel\`: what a driver would call it WITHOUT the sheet in front of them: end, corner or pivot
  (FF / FR / RF / RR), the part, units in brackets. **Two different boxes must never share a
  displayLabel.** Use the house words in the primer.
- \`section\`: the printed section heading in Title Case, from the briefing's block list.
- \`fieldKind\`: "text" for a written value; for tick boxes "choice" when exactly one gets marked,
  "multi" when several commonly do (screw positions, weight positions, top-deck cuts).
- \`options\`: for tick groups ONLY (\`widgets\` > 1): one entry per box, \`{"widgetIndex": <k − 1>,
  "label": "<printed word beside THAT box>"}\`, every box exactly once. Where a tick sits on a drawing with
  no printed word, describe its position tersely and uniquely ("front screw, left", "hole 2 of 4").
- A LONE tick box (\`widgets\` = 1) is usually one option of a set drawn as separate PDF fields ("YES" and
  "NO" as two fields). Then set \`optionSetName\` to the set's name and \`optionLabel\` to THIS box's
  printed word; \`displayLabel\` = the set name. Keep \`fieldKind\` "choice".
- \`universalParameterId\`: ONLY when the box is one of these cross-car parameters, matched to the right
  end and pivot. Omit it otherwise — a wrong one is worse than none.
${ids.length ? `\n  ${ids.join(", ")}\n` : "\n  (none registered for this discipline)\n"}
- \`confidence\`: 0 to 1, your honest probability that \`displayLabel\` is what a careful racer who owns
  this car would write. A clearly traced leader line onto a part you can name is high confidence even
  with no printed word. Below 0.6 when the box could be one of two things. Two helpers name every box
  independently and only boxes where both agree AND both are confident get used, so an honest low
  number costs nothing and a bluffed high one costs a wrong name.

## Output

Write ONE JSON file at the path you are given: \`{"fields":[{...}, ...]}\` covering EVERY field you were
given, in the given order. No prose in the file.

---

${primer}

---

${layout}
`;

fs.writeFileSync(path.join(dir, "instructions.md"), md);
console.log(`instructions.md written for ${sheet.name} (${sheet.fields} boxes, mode=${mode})`);
