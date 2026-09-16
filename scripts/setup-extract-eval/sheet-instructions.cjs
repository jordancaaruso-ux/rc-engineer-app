/**
 * Build the briefing every naming helper reads for one sheet.
 *
 *   node scripts/setup-extract-eval/sheet-instructions.cjs <workDir>
 *
 * Reads <workDir>/sheet.json and <workDir>/layout.md, writes <workDir>/instructions.md.
 * The layout half is written by a helper that reads the gridded page; the rules half is the
 * same for every sheet and lives here.
 */
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) throw new Error("usage: sheet-instructions.cjs <workDir>");

const sheet = JSON.parse(fs.readFileSync(path.join(dir, "sheet.json"), "utf8"));
const layoutPath = path.join(dir, "layout.md");
const layout = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, "utf8") : null;
if (!layout) throw new Error(`no layout.md in ${dir} — run the layout helper first`);

const ids = (sheet.universalParameters || []).map((p) => p.id);

const md = `# Naming the boxes of the ${sheet.name} blank setup sheet

You are naming the input boxes of a BLANK RC car setup sheet so that a driver's filled-in values can
be imported as real setup parameters. You get a batch file (JSON) listing fields.

For EACH field, Read its \`box\` picture. One picture holds three panels:

1. **CLOSE-UP** — the box outlined in pink, with the print around it. When a field has several tick
   boxes they are numbered 1, 2, 3… in pink. **Those numbers are positions we added, not printed text.**
2. **WIDER VIEW** — the same box with more of the sheet around it, for the section heading.
3. **WHOLE PAGE** — the whole sheet with a pink marker and crosshair on this box, so you can see
   which printed block it sits in.

Read the picture once. Everything you need is in it. Do not open other files.

## Rules that decide the name

- **Which end of the car.** Work it out from the layout briefing below plus where the crosshair
  falls on the whole-page panel. A close-up lies: a rear upright drawing looks exactly like a front
  one. The briefing's coordinates and its "Traps" section outrank your impression of the close-up.
- **The PDF's own field name** (the \`name\` in the batch) sometimes carries the answer and sometimes
  lies. Where it names an end ("fr_", "re_", "rear_"), prefer it over the layout — the author meant
  it. Where the print beside the box contradicts it, the PRINT wins and you should say so in
  \`printedLabel\`.
- **Never invent a value.** You are naming the empty box, not filling it in.

## What to return for each field

- \`name\`: echo the field name EXACTLY as given.
- \`printedLabel\`: the exact printed words on or beside the outlined box ("" if none).
- \`displayLabel\`: what a driver would call it WITHOUT the sheet in front of them. Resolve front/rear
  and which corner from the pictures and the briefing. Keep printed units in brackets. **Two
  different boxes must never share a displayLabel** — say which end, which corner, which row. House
  words: "shock" not "damper", "anti-roll bar", "diff", "ride height", "downstop", "droop", "camber
  link", "upright", "hex width", "shock angle", "top deck", "motor mount".
- \`section\`: the printed section heading in Title Case, taken from the briefing's block list.
- \`fieldKind\`: "text" for a written value; for tick boxes "choice" when exactly one gets marked,
  "multi" when several commonly do.
- \`options\`: for tick groups ONLY (\`widgets\` > 1): one entry per numbered box,
  \`{"widgetIndex": <the number shown minus 1>, "label": "<printed word beside THAT box>"}\`. Every
  number must appear exactly once. Where a tick sits on a drawing with no printed word, describe its
  position tersely and uniquely ("screw 1 (front left)", "hex, two dots").
- A LONE tick box (\`widgets\` = 1) is usually one option of a set drawn as separate PDF fields
  ("YES" and "NO" as two fields). Then set \`optionSetName\` to the set's name and \`optionLabel\` to
  THIS box's printed word; \`displayLabel\` = the set name. Keep \`fieldKind\` "choice".
- \`universalParameterId\`: ONLY when the box is one of these cross-car concepts, matched to the right
  end of the car. Omit it otherwise — a wrong one is worse than none.
${ids.length ? `\n  ${ids.join(", ")}\n` : "\n  (none registered for this discipline)\n"}
- \`confidence\`: 0 to 1, your honest probability that \`displayLabel\` is what a careful human who
  races this car would write. **Below 0.6 whenever the print is ambiguous, the box could belong to
  two things, or the briefing calls this area a trap.** Two helpers name every box independently and
  only boxes where both agree AND both are confident get used, so an honest low number costs
  nothing and a bluffed high one costs a wrong name.

## Output

Write ONE JSON file at the path you are given: \`{"fields":[{...}, ...]}\` covering EVERY field in
your batch, in batch order. No prose in the file. Then reply with one line: how many fields you
named, and the names of any you were unsure about.

---

${layout}
`;

fs.writeFileSync(path.join(dir, "instructions.md"), md);
console.log(`instructions.md written for ${sheet.name} (${sheet.fields} boxes, ${sheet.batches.length} batches)`);
