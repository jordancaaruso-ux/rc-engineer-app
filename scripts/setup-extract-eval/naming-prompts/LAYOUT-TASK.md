# Task: map the printed layout of a blank RC car setup sheet

You are given a CAR NAME and a WORK FOLDER. Other helpers will name the boxes block by block from
high-resolution pictures of each block; your job decides what those blocks are and briefs them.

Read, in the work folder, in TWO steps (each step = several Read calls in one message):

Step 1, together:
- `page-grid.jpg` — the whole sheet with a blue dashed grid every 0.1 of the page, `x=0.1 … 0.9`
  along the top and bottom, `y=0.1 … 0.9` down both sides. x grows right, y grows DOWN.
- `page-grid-boxes.jpg` — the same, with every fillable box outlined in pink.
- `boxes.txt` — every fillable box: its PDF field name, kind and centre on the page.
- `tiles/index.txt` — the close-up tiles and the part of the page each one covers.

Step 2, together: every tile in `tiles/` (`r1c1.jpg`, `r1c2.jpg`, …). Each is a part of the page at
full resolution with a fine grid every 0.01 (labelled every 0.05) and every fillable box outlined in
pink with its PDF field name. Neighbouring tiles overlap, so a drawing cut by one tile's edge is whole
in the next. The whole pictures are too small to read fine print; the tiles are not.

READ coordinates off the grids rather than estimating. Do not open anything else.

Write TWO files in the work folder.

## 1. `blocks.json` — the naming units

`{"blocks":[{"id","label","axle","view","frontOfCar","x0","y0","x1","y1","note"}, ...]}`

- **Every pink box must sit inside at least one block** (judged by the box's centre).
- A block is one printed section, OR **one drawing together with every box whose leader line runs into
  it**. Never separate a drawing from its callout boxes, even if the boxes sit in a row above or
  below the drawing.
- Aim for 5–20 boxes per block. Split a long table or header into smaller blocks by rows; never split
  a drawing from its callouts to get there.
- Blocks may nest (a parent section and its front and rear halves). A box is named with the SMALLEST
  block containing its centre, so make the small blocks the useful ones.
- `id`: short unique slug. `label`: the printed heading ("(no heading — race header)" if none).
- `axle`: "front" | "rear" | "both" | "none".
- `view`: "side" | "front" | "rear" | "top" | "bottom" | "droop" | "table" | "header" | "none".
- `frontOfCar`: for drawings, which way the FRONT of the car points in the picture — "left" |
  "right" | "up" | "down" | "toward viewer" | "away from viewer"; null for tables. Decide it from the
  bumper, the steering, a printed FRONT/REAR, the direction of caster lines.
- `note`: one sentence on what the drawing shows ("side view of the front corner: hub with caster
  line, upper A-arm on two links, lower arm mounts on the chassis, steering link").

## 2. `layout.md` — the briefing for the namers

1. How the sheet is organised: columns, halves, bands, and which way the car faces in each drawing.
2. Every block: the heading as printed, its rectangle as `x 0.00–0.00, y 0.00–0.00`, FRONT / REAR /
   BOTH / none, and the parameters printed inside.
3. **Traps on this sheet**: anything that would mislead somebody naming one box — one drawing carrying
   front parts on one side and rear on the other, repeated blocks that differ only by end, columns
   labelled only at the top, tick rows labelled only at the ends, boxes with no printed label, PDF
   boxes that sit on a different printed word than you would expect.

Keep `layout.md` under about 200 lines. Do not guess a heading you cannot read; say so.

Say where each line lands in plain shapes ("a rod end at the top", "the round spacer under it", "the
low 3-2-1 hole row by the bulkhead"). Do not decide which link or adjustment an unprinted part is
(steering link, servo link, camber link…): the namers decide that, and a wrong call here would be
copied by every one of them.

Reply with ONE line: the number of blocks.
