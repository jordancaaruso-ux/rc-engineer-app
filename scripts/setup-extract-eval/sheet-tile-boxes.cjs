// The quick naming recipe (2026-09-26): no layout step. After sheet-tiles.cjs has cut a sheet into
// overlapping close-up tiles, give every box to the tile whose core (overlaps split at their midpoints)
// holds its centre, and write the rules + primer without a layout briefing. One namer per tile then
// runs naming-prompts/TILE-NAMING-TASK.md.
//
//   node scripts/setup-extract-eval/sheet-tile-boxes.cjs <workDir>
//
// Writes <workDir>/tiles/<tile>-boxes.txt and <workDir>/instructions-quick.md (instructions.md cut
// before its "layout briefing" heading; if a sheet has no instructions.md yet, build it first).
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) throw new Error("usage: sheet-tile-boxes.cjs <workDir>");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

const insPath = path.join(dir, "instructions.md");
if (fs.existsSync(insPath)) {
  const ins = fs.readFileSync(insPath, "utf8");
  const heading = ins.split("\n").find((l) => l.startsWith("# ") && /layout briefing/i.test(l));
  fs.writeFileSync(path.join(dir, "instructions-quick.md"), (heading ? ins.slice(0, ins.indexOf(heading)) : ins).trimEnd() + "\n");
} else {
  console.warn("no instructions.md: build the rules + primer first (sheets:instructions)");
}

const tiles = fs.readFileSync(path.join(dir, "tiles", "index.txt"), "utf8").split("\n")
  .map((l) => l.match(/^(r\d+c\d+)\.jpg\s+x ([\d.]+)–([\d.]+), y ([\d.]+)–([\d.]+)/)).filter(Boolean)
  .map((t) => ({ id: t[1], x0: +t[2], x1: +t[3], y0: +t[4], y1: +t[5] }));
function core(t) {
  const mid = (a, b) => (a + b) / 2;
  const left = tiles.find((o) => o.x0 < t.x0 && o.x1 > t.x0 && o.x1 < t.x1);
  const right = tiles.find((o) => o.x1 > t.x1 && o.x0 < t.x1 && o.x0 > t.x0);
  const top = tiles.find((o) => o.y0 < t.y0 && o.y1 > t.y0 && o.y1 < t.y1);
  const bottom = tiles.find((o) => o.y1 > t.y1 && o.y0 < t.y1 && o.y0 > t.y0);
  return {
    left: left ? mid(left.x1, t.x0) : -1, right: right ? mid(right.x0, t.x1) : 2,
    top: top ? mid(top.y1, t.y0) : -1, bottom: bottom ? mid(bottom.y0, t.y1) : 2,
  };
}

let total = 0;
for (const t of tiles) {
  const c = core(t);
  const mine = manifest.fields.filter((f) => {
    const b = f.region, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return cx >= c.left && cx < c.right && cy >= c.top && cy < c.bottom;
  });
  total += mine.length;
  const lines = mine.map((f) => {
    const b = f.region;
    const group = f.widgets > 1 ? ` x${f.widgets} (labelled ${f.name}#0 … #${f.widgets - 1})` : "";
    return `${f.name} | ${f.kind}${group} | centre x ${(b.x + b.w / 2).toFixed(3)}, y ${(b.y + b.h / 2).toFixed(3)}`;
  });
  fs.writeFileSync(path.join(dir, "tiles", `${t.id}-boxes.txt`), `${mine.length} boxes to name (PDF field name | kind | centre as a fraction of the page):\n${lines.join("\n")}\n`);
  console.log(`${t.id}: ${mine.length} boxes`);
}
console.log(`${dir}: ${total} of ${manifest.fields.length} boxes given to ${tiles.length} tiles`);
