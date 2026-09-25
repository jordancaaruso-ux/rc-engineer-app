// Pre-cut close-up tiles of a prepped sheet for the lean layout helper, so it never needs to run a
// script or cut its own crops (2026-09-25: the general-purpose layout helper spent ~25 steps and 3.5-6M
// tokens a sheet, much of it writing a crop tool and zooming one region per step).
//
//   node scripts/setup-extract-eval/sheet-tiles.cjs <workDir>
//
// Writes <workDir>/tiles/rNcM.jpg (overlapping tiles, each under ~1.15 MP so the reader never
// downscales them; a fine grid every 0.01 of the page, labelled every 0.05; every fillable box outlined
// in pink with its PDF field name), tiles/index.txt (each tile's rectangle) and boxes.txt (one line per
// box: name, kind, widgets, centre).
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const dir = process.argv[2];
if (!dir) throw new Error("usage: sheet-tiles.cjs <workDir>");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const src = fs.existsSync(path.join(dir, "page6.png")) ? path.join(dir, "page6.png") : path.join(dir, "page.png");

const LONG_SIDE_PX = 3100; // ~10 px per mm on an A4/letter page: small print stays readable
const MAX_W = 1200, MAX_H = 950; // one tile, under ~1.15 MP
const OVERLAP = 0.06; // of the page, so a drawing cut by one tile edge is whole in the next
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function spans(pagePx, tilePx) {
  const n = Math.max(1, Math.ceil((pagePx - OVERLAP * pagePx) / (tilePx - OVERLAP * pagePx)));
  const size = Math.min(1, (1 + (n - 1) * OVERLAP) / n);
  const out = [];
  for (let i = 0; i < n; i++) { const a = n === 1 ? 0 : (i * (1 - size)) / (n - 1); out.push([a, a + size]); }
  return out;
}

(async () => {
  const meta = await sharp(src).metadata();
  const scale = LONG_SIDE_PX / Math.max(meta.width, meta.height);
  const PW = Math.round(meta.width * scale), PH = Math.round(meta.height * scale);
  const cols = spans(PW, MAX_W), rows = spans(PH, MAX_H);
  const page = await sharp(src).resize({ width: PW, height: PH }).png().toBuffer();
  fs.mkdirSync(path.join(dir, "tiles"), { recursive: true });
  const index = [];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
    const [x0, x1] = cols[c], [y0, y1] = rows[r];
    const left = Math.round(x0 * PW), top = Math.round(y0 * PH);
    const w = Math.min(PW - left, Math.round((x1 - x0) * PW)), h = Math.min(PH - top, Math.round((y1 - y0) * PH));
    const k = Math.min(1, MAX_W / w, MAX_H / h);
    const ow = Math.round(w * k), oh = Math.round(h * k);
    const X = (fx) => ((fx - x0) * PW * k).toFixed(1), Y = (fy) => ((fy - y0) * PH * k).toFixed(1);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}">`;
    for (let g = Math.ceil(x0 * 100); g <= Math.floor(x1 * 100); g++) {
      const major = g % 5 === 0;
      svg += `<line x1="${X(g / 100)}" y1="0" x2="${X(g / 100)}" y2="${oh}" stroke="${major ? "#0066ff" : "#8fbfff"}" stroke-width="${major ? 1.2 : 0.5}" stroke-dasharray="${major ? "6,3" : "2,4"}"/>`;
      if (major) svg += `<text x="${+X(g / 100) + 2}" y="11" font-size="11" fill="#0044cc" font-family="Arial">${(g / 100).toFixed(2)}</text><text x="${+X(g / 100) + 2}" y="${oh - 3}" font-size="11" fill="#0044cc" font-family="Arial">${(g / 100).toFixed(2)}</text>`;
    }
    for (let g = Math.ceil(y0 * 100); g <= Math.floor(y1 * 100); g++) {
      const major = g % 5 === 0;
      svg += `<line x1="0" y1="${Y(g / 100)}" x2="${ow}" y2="${Y(g / 100)}" stroke="${major ? "#0066ff" : "#8fbfff"}" stroke-width="${major ? 1.2 : 0.5}" stroke-dasharray="${major ? "6,3" : "2,4"}"/>`;
      if (major) svg += `<text x="2" y="${+Y(g / 100) - 2}" font-size="11" fill="#0044cc" font-family="Arial">${(g / 100).toFixed(2)}</text><text x="${ow - 30}" y="${+Y(g / 100) - 2}" font-size="11" fill="#0044cc" font-family="Arial">${(g / 100).toFixed(2)}</text>`;
    }
    for (const f of manifest.fields) {
      (f.widgetRegions && f.widgetRegions.length ? f.widgetRegions : [f.region]).forEach((b, i) => {
        if (!b) return;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return;
        svg += `<rect x="${X(b.x)}" y="${Y(b.y)}" width="${(b.w * PW * k).toFixed(1)}" height="${(b.h * PH * k).toFixed(1)}" fill="none" stroke="#e000a0" stroke-width="1.5"/>`;
        const label = f.name + (f.widgets > 1 ? `#${i}` : "");
        svg += `<text x="${X(b.x)}" y="${+Y(b.y) - 1}" font-size="10" fill="#c00070" font-family="Arial" stroke="white" stroke-width="2.5" paint-order="stroke">${esc(label)}</text>`;
      });
    }
    svg += "</svg>";
    const name = `r${r + 1}c${c + 1}.jpg`;
    await sharp(page).extract({ left, top, width: w, height: h }).resize({ width: ow, height: oh })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 88 }).toFile(path.join(dir, "tiles", name));
    index.push(`${name}  x ${x0.toFixed(2)}–${x1.toFixed(2)}, y ${y0.toFixed(2)}–${y1.toFixed(2)}`);
  }
  fs.writeFileSync(path.join(dir, "tiles", "index.txt"), `${index.length} tiles (row r, column c), each a part of the page at high resolution:\n${index.join("\n")}\n`);
  const lines = manifest.fields.map((f) => { const b = f.region; return `${f.name} | ${f.kind}${f.widgets > 1 ? ` x${f.widgets}` : ""} | centre x ${(b.x + b.w / 2).toFixed(3)}, y ${(b.y + b.h / 2).toFixed(3)}`; });
  fs.writeFileSync(path.join(dir, "boxes.txt"), `${lines.length} fillable boxes (PDF field name | kind | centre as a fraction of the page):\n${lines.join("\n")}\n`);
  console.log(`${dir}: ${index.length} tiles (${cols.length} x ${rows.length}), ${lines.length} boxes`);
})();
