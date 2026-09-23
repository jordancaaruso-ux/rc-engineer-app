/**
 * Whole-drawing pictures for the naming helpers ("block naming", v3).
 *
 * The per-box pictures (`buildComposite`) crop each box around ITSELF, so on a sheet whose boxes
 * print only "SHIMS" the leader line leaves the frame before it reaches the part it points at, and
 * the helper can only name the box by where it sits ("front shims, top row, 2nd box"). Here every
 * printed block (from the layout helper's `blocks.json`) is cut from a 6x render in one picture,
 * with every box in it outlined and tagged 1, 2, 3… (tick groups 4.1, 4.2…). One helper names the
 * whole block at once: it sees each leader line end on its part, and it sees the four shims around
 * one arm together, so it can tell FF from FR.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/sheet-blocks.ts --work=<sheetDir> [--max-fields=22]
 *
 * Needs manifest.json (with widgetRegions), blocks.json, blank.pdf. Writes blocks/part-NN.{jpg,json}
 * and blocks/index.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";

type Rect = { x: number; y: number; w: number; h: number };
type Block = { id: string; label: string; axle?: string; view?: string; frontOfCar?: string; x0: number; y0: number; x1: number; y1: number; note?: string };
type MField = { name: string; kind: string; widgets: number; where: string; nameSaysAxle: string | null; region: Rect; widgetRegions?: Rect[]; box?: string };
type Part = { block: Block; rect: Rect; fields: MField[]; partOf?: string };

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const MAX_EDGE = 1560;
const MIN_SCALE = 0.5;
const PINK = "#ff00c8";

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const area = (b: Block) => Math.max(1e-6, (b.x1 - b.x0) * (b.y1 - b.y0));
const blockRect = (b: Block): Rect => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

function distToBlock(p: { x: number; y: number }, b: Block): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.hypot(dx, dy);
}

/** The smallest block that contains the box's centre; else the nearest block. */
function assign(f: MField, blocks: Block[]): Block {
  const c = centre(f.region);
  const inside = blocks.filter((b) => c.x >= b.x0 - 0.002 && c.x <= b.x1 + 0.002 && c.y >= b.y0 - 0.002 && c.y <= b.y1 + 0.002);
  if (inside.length) return inside.sort((a, b) => area(a) - area(b))[0];
  return [...blocks].sort((a, b) => distToBlock(c, a) - distToBlock(c, b))[0];
}

/** Grow a rect so every widget of every field fits, plus a margin; clamp to the page. */
function cover(base: Rect, fields: MField[], pad = 0.008): Rect {
  let x0 = base.x, y0 = base.y, x1 = base.x + base.w, y1 = base.y + base.h;
  for (const f of fields) for (const r of f.widgetRegions ?? [f.region]) {
    x0 = Math.min(x0, r.x - pad); y0 = Math.min(y0, r.y - pad);
    x1 = Math.max(x1, r.x + r.w + pad); y1 = Math.max(y1, r.y + r.h + pad);
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Split a part in two along its long side at the median box centre, until it is small enough. */
function split(part: Part, W: number, H: number, maxFields: number): Part[] {
  const pxW = part.rect.w * W, pxH = part.rect.h * H;
  const scale = Math.min(1, MAX_EDGE / Math.max(pxW, pxH));
  if (part.fields.length <= maxFields && scale >= MIN_SCALE) return [part];
  if (part.fields.length < 2) return [part];
  const horizontal = pxW >= pxH;
  const cs = part.fields.map((f) => (horizontal ? centre(f.region).x : centre(f.region).y)).sort((a, b) => a - b);
  const cut = cs[Math.floor(cs.length / 2)];
  const a = part.fields.filter((f) => (horizontal ? centre(f.region).x : centre(f.region).y) < cut);
  const b = part.fields.filter((f) => (horizontal ? centre(f.region).x : centre(f.region).y) >= cut);
  if (!a.length || !b.length) return [part];
  const r = part.rect;
  const overlap = 0.03;
  const ra: Rect = horizontal ? { x: r.x, y: r.y, w: Math.min(r.w, cut - r.x + overlap), h: r.h } : { x: r.x, y: r.y, w: r.w, h: Math.min(r.h, cut - r.y + overlap) };
  const rb: Rect = horizontal ? { x: Math.max(r.x, cut - overlap), y: r.y, w: r.x + r.w - Math.max(r.x, cut - overlap), h: r.h } : { x: r.x, y: Math.max(r.y, cut - overlap), w: r.w, h: r.y + r.h - Math.max(r.y, cut - overlap) };
  const label = part.block.label;
  return [
    ...split({ ...part, rect: cover(ra, a, 0.006), fields: a, partOf: label }, W, H, maxFields),
    ...split({ ...part, rect: cover(rb, b, 0.006), fields: b, partOf: label }, W, H, maxFields),
  ];
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box, m = 2) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

async function drawPart(page6: Buffer, W: number, H: number, part: Part, outJpg: string) {
  const left = Math.round(part.rect.x * W), top = Math.round(part.rect.y * H);
  const width = Math.max(1, Math.round(part.rect.w * W)), height = Math.max(1, Math.round(part.rect.h * H));
  const s = Math.min(1, MAX_EDGE / Math.max(width, height));
  const outW = Math.round(width * s), outH = Math.round(height * s);
  const base = await sharp(page6).extract({ left, top, width, height }).resize({ width: outW, height: outH }).toBuffer();
  const grey = await sharp(base).greyscale().raw().toBuffer({ resolveWithObject: true });
  const px = grey.data, gw = grey.info.width, gh = grey.info.height;
  const ink = (b: Box) => {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), x1 = Math.min(gw, Math.ceil(b.x + b.w)), y1 = Math.min(gh, Math.ceil(b.y + b.h));
    if (x1 <= x0 || y1 <= y0) return 1;
    let dark = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (px[y * gw + x] < 170) dark++;
    return dark / ((x1 - x0) * (y1 - y0));
  };
  const toPx = (r: Rect): Box => ({ x: (r.x * W - left) * s, y: (r.y * H - top) * s, w: r.w * W * s, h: r.h * H * s });

  const widgets: Array<{ field: number; k: number; box: Box; text: boolean }> = [];
  part.fields.forEach((f, i) => (f.widgetRegions ?? [f.region]).forEach((r, k) => widgets.push({ field: i, k, box: toPx(r), text: f.kind === "text" })));

  const placed: Box[] = [];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">`;
  for (const w of widgets) svg += `<rect x="${w.box.x - 2}" y="${w.box.y - 2}" width="${w.box.w + 4}" height="${w.box.h + 4}" fill="none" stroke="${PINK}" stroke-width="3"/>`;
  for (const w of widgets) {
    const f = part.fields[w.field];
    const label = (f.widgetRegions?.length ?? 1) > 1 ? `${w.field + 1}.${w.k + 1}` : `${w.field + 1}`;
    const tw = 11 * label.length + 10, th = 22;
    const b = w.box;
    const cands: Array<Box & { bonus: number }> = [];
    if (w.text && b.w >= tw + 6 && b.h >= th + 4) cands.push({ x: b.x + 3, y: b.y + 3, w: tw, h: th, bonus: -0.04 });
    cands.push(
      { x: b.x - tw - 5, y: b.y + b.h / 2 - th / 2, w: tw, h: th, bonus: 0 },
      { x: b.x, y: b.y - th - 4, w: tw, h: th, bonus: 0.005 },
      { x: b.x + b.w + 5, y: b.y + b.h / 2 - th / 2, w: tw, h: th, bonus: 0.01 },
      { x: b.x, y: b.y + b.h + 4, w: tw, h: th, bonus: 0.015 },
      { x: b.x + b.w - tw, y: b.y - th - 4, w: tw, h: th, bonus: 0.02 },
      { x: b.x + b.w - tw, y: b.y + b.h + 4, w: tw, h: th, bonus: 0.025 },
      { x: b.x - tw - 5, y: b.y - th - 2, w: tw, h: th, bonus: 0.03 },
      { x: b.x + b.w + 5, y: b.y - th - 2, w: tw, h: th, bonus: 0.035 },
    );
    let best: (Box & { bonus: number }) | null = null, bestScore = Infinity;
    for (const c of cands) {
      if (c.x < 0 || c.y < 0 || c.x + c.w > outW || c.y + c.h > outH) continue;
      if (placed.some((p) => overlaps(p, c))) continue;
      const hitsOther = widgets.some((o) => o !== w && overlaps(o.box, c, 1));
      const inside = c.x >= b.x && c.y >= b.y && c.x + c.w <= b.x + b.w + 1 && c.y + c.h <= b.y + b.h + 1;
      const score = ink(c) + c.bonus + (hitsOther ? 0.5 : 0) + (inside ? 0 : 0.01);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    const t = best ?? { x: Math.max(0, Math.min(outW - tw, b.x)), y: Math.max(0, Math.min(outH - th, b.y - th - 2)), w: tw, h: th, bonus: 0 };
    placed.push(t);
    svg += `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="3" fill="${PINK}" stroke="#ffffff" stroke-width="1.5"/>`;
    svg += `<text x="${t.x + t.w / 2}" y="${t.y + 16.5}" text-anchor="middle" font-family="Arial" font-size="17" font-weight="bold" fill="#ffffff">${label}</text>`;
  }
  svg += `</svg>`;
  await sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90 }).toFile(outJpg);
  return { outW, outH, scale: s };
}

async function pageThumb(pagePng: Buffer, rect: Rect, out: string) {
  const outW = 620;
  const m = await sharp(pagePng).metadata();
  const s = outW / (m.width ?? outW), outH = Math.round((m.height ?? outW) * s);
  const x = rect.x * outW, y = rect.y * outH, w = rect.w * outW, h = rect.h * outH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}"><rect x="0" y="0" width="${outW}" height="${outH}" fill="rgba(255,255,255,0.35)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,0,200,0.12)" stroke="${PINK}" stroke-width="4"/></svg>`;
  await sharp(pagePng).resize({ width: outW }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toFile(out);
}

async function main() {
  const dir = arg("work");
  if (!dir) throw new Error("need --work=<sheetDir>");
  const maxFields = Number(arg("max-fields") ?? 22);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { carName: string; fields: MField[] };
  const rawBlocks = JSON.parse(readFileSync(join(dir, "blocks.json"), "utf8")) as Block[] | { blocks: Block[] };
  const blocks = (Array.isArray(rawBlocks) ? rawBlocks : rawBlocks.blocks).filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
  if (!manifest.fields.every((f) => f.widgetRegions)) throw new Error("manifest has no widgetRegions: re-run sheet-prep");

  const page6Path = join(dir, "page6.png");
  if (!existsSync(page6Path)) {
    const png = await renderPdfFirstPageToPng(new Uint8Array(readFileSync(join(dir, "blank.pdf"))), { scale: 6 });
    writeFileSync(page6Path, png);
  }
  const page6 = readFileSync(page6Path);
  const meta = await sharp(page6).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const pagePng = readFileSync(join(dir, "page.png"));

  const groups = new Map<string, { block: Block; fields: MField[] }>();
  for (const f of manifest.fields) {
    const b = assign(f, blocks);
    if (!groups.has(b.id)) groups.set(b.id, { block: b, fields: [] });
    groups.get(b.id)!.fields.push(f);
  }

  let parts: Part[] = [];
  for (const g of groups.values()) {
    g.fields.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
    parts.push(...split({ block: g.block, rect: cover(blockRect(g.block), g.fields), fields: g.fields }, W, H, maxFields));
  }
  parts = parts.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  const out = join(dir, "blocks");
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const index: Array<Record<string, unknown>> = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    p.fields.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
    const n = String(i + 1).padStart(2, "0");
    const jpg = join(out, `part-${n}.jpg`), thumb = join(out, `part-${n}-page.jpg`);
    const d = await drawPart(page6, W, H, p, jpg);
    await pageThumb(pagePng, p.rect, thumb);
    const json = {
      carName: manifest.carName,
      part: n,
      block: { label: p.block.label, axle: p.block.axle ?? null, view: p.block.view ?? null, frontOfCar: p.block.frontOfCar ?? null, note: p.block.note ?? null, partOf: p.partOf ?? null },
      picture: jpg,
      pageThumb: thumb,
      fields: p.fields.map((f, k) => ({
        tag: String(k + 1),
        tags: (f.widgetRegions?.length ?? 1) > 1 ? f.widgetRegions!.map((_, j) => `${k + 1}.${j + 1}`) : undefined,
        name: f.name, kind: f.kind, widgets: f.widgets, where: f.where, nameSaysAxle: f.nameSaysAxle, box: f.box,
      })),
    };
    writeFileSync(join(out, `part-${n}.json`), JSON.stringify(json, null, 1));
    index.push({ part: n, block: p.block.label, partOf: p.partOf ?? null, fields: p.fields.length, picturePx: `${d.outW}x${d.outH}`, scale: +d.scale.toFixed(2) });
  }
  writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1));
  const assigned = parts.reduce((n, p) => n + p.fields.length, 0);
  console.log(`${manifest.carName}: ${assigned}/${manifest.fields.length} boxes in ${parts.length} block pictures`);
  for (const r of index) console.log(`  part ${r.part}  ${String(r.fields).padStart(3)} boxes  ${r.picturePx} @${r.scale}  ${r.block}${r.partOf ? " (split)" : ""}`);
}

main();
