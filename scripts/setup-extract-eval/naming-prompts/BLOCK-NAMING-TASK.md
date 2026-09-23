# Task: name every box in one block of a blank RC car setup sheet

You are given a WORK FOLDER, a PART number and a PASS letter.

1. Read `instructions.md` in the work folder, in full: the naming rules, the primer on reading
   setup-sheet drawings, and this sheet's layout briefing.
2. Read `blocks/part-<PART>.json`: the boxes you must name, each with its `tag`.
3. Read `blocks/part-<PART>.jpg`: the whole block, cut from a high-resolution render. Every box you
   must name is outlined in pink and carries a pink tag with its number. A tick group's boxes are
   tagged 4.1, 4.2, … — the number after the dot is k, and that box's `widgetIndex` is k − 1. The tags
   and outlines are ours, not printed on the sheet. Read `blocks/part-<PART>-page.jpg` only if you
   need to see where the block sits on the page.
4. For each box: read the print beside it. If it prints only a generic word ("SHIMS", "mm", "g",
   "HEIGHT", a part number) or nothing, follow its leader line to where it ENDS and name the part it
   lands on, as the primer explains. Decide related boxes together (the pivots of one arm, the ends
   of one link) and give each a distinct name.
5. Only if a tag or a line is unclear, Read that box's own `box` picture (close-up, wider view,
   whole page). Do not open anything else.
6. Write `labels-<PASS>/part-<PART>.json` in the work folder as `{"fields":[ ... ]}` — one entry per
   box, in the JSON's order, echoing each `name` exactly, with every field the rules ask for.

Reply with ONE short line: how many you named.
