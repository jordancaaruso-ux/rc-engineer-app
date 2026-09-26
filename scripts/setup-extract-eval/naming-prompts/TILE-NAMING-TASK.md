# Task: name every box in one tile of a blank RC car setup sheet (quick recipe, no layout step)

Paste this into each namer's prompt with WORK FOLDER, CAR, TILE and OUTPUT filled in (the task text in
the prompt saves the namer a step). Agent type `sheet-namer`. One namer per tile, all at once.

---

WORK FOLDER: <work folder> (<car name>). TILE: <rNcM>.
Your whole task is below (there is no task file to open).

1. Read these four files TOGETHER, in ONE step (four Read calls in a single message), all in the work folder:
   - `instructions-quick.md`: the naming rules and a primer on reading setup-sheet drawings.
   - `tiles/<rNcM>.jpg`: one part of the sheet at high resolution. Every fillable box is outlined in pink and labelled with its PDF field name. A tick group's boxes are labelled name#0, name#1, …, and that number IS the box's widgetIndex. There are no numbered tags on this sheet; where the rules mention a tag, use the box's label instead.
   - `tiles/<rNcM>-boxes.txt`: the boxes you must name.
   - `page-grid-boxes.jpg`: the whole sheet, for context: which drawing a box belongs to, which way the car faces, which half is front or rear.
2. Name every box in your list, following the rules. Read the print beside it; if it prints only a generic word or nothing, follow its leader line to where it ends and name the part it lands on. A box near the edge of your tile may belong to a drawing that continues in the next tile: `tiles/index.txt` says which tile covers which part of the page, and you may Read that neighbouring tile. Open nothing else.
3. Write <OUTPUT: work folder>\labels-a\tile-<rNcM>.json as {"fields":[ ... ]}: one entry per box in your list, in its order, echoing each name exactly, with every field the rules ask for.

Reply with ONE short line: how many you named.
