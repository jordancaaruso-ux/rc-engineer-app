/**
 * Blank-sheet naming, v2 — per-box crops instead of a coordinate hunt.
 *
 * v1 (`draftCalibrationFromBlankSheet`) hands the model the whole page plus a list of numeric
 * coordinates and asks it to find each box. On a dense sheet (RC Maker SP2, 248 boxes) two v1
 * passes agreed on 31 of 180 names — it loses its place. v2 crops every box out with its printed
 * surroundings, outlines the box in the crop, numbers each widget of a tick group, and asks the
 * model to READ what is printed beside it. Naming becomes a read, not a search.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/draft-blank-v2.ts --pdf=<blank.pdf> --car="RC Maker SP2" --out=<result.json>
 *     [--model=gpt-5] [--per-call=6] [--concurrency=4] [--scale=3] [--crops=<dir>] [--limit=N]
 *
 * Output is the same shape as v1's BlankSheetDraftResult (draftedSchema + imageCalibration +
 * formFieldMappings) plus per-field `confidence` and `printedLabel`, so the review page and the
 * app's wiring can consume either.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import {
  parseBlankAcroFormGeometry,
  widgetInstanceIndexByGeometryIndex,
  BLANK_REFERENCE_DOCUMENT_ID,
  type BlankFieldGeometry,
  type BlankAcroFormGeometry,
} from "@/lib/setupExtractAi/draftCalibrationFromBlankSheet";
import { suggestUniversalParameterId, universalParameterCatalogForPrompt } from "@/lib/setupSheetModels/matchUniversalParameter";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { ImageCalibration, ImageCalibrationField, ImageRegion, PdfFormFieldMappingRule, PdfFormWidgetInstanceRef } from "@/lib/setupCalibrations/types";
import type { DraftedField, DraftedSchema } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

// ---------- crops ----------

type Crop = { tight: string; wide: string; page: string; box?: string };

/** Some PDFs store a widget rect with a negative height (y1 < y0). Normalise so every region has w,h > 0. */
function normRegion(r: ImageRegion): ImageRegion {
  const x = r.wPct < 0 ? r.xPct + r.wPct : r.xPct, y = r.hPct < 0 ? r.yPct + r.hPct : r.yPct;
  return { xPct: x, yPct: y, wPct: Math.abs(r.wPct), hPct: Math.abs(r.hPct) };
}

function unionRegion(f: BlankFieldGeometry): ImageRegion {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const w of f.widgets) {
    const r = normRegion(w.region);
    x0 = Math.min(x0, r.xPct); y0 = Math.min(y0, r.yPct);
    x1 = Math.max(x1, r.xPct + r.wPct); y1 = Math.max(y1, r.yPct + r.hPct);
  }
  return { xPct: x0, yPct: y0, wPct: x1 - x0, hPct: y1 - y0 };
}

function padded(r: ImageRegion, padX: number, padY: number): ImageRegion {
  const x = Math.max(0, r.xPct - padX), y = Math.max(0, r.yPct - padY);
  const right = Math.min(1, r.xPct + r.wPct + padX), bottom = Math.min(1, r.yPct + r.hPct + padY);
  return { xPct: x, yPct: y, wPct: right - x, hPct: bottom - y };
}

/** Crop `window` out of the page and draw the field's widgets (outlined + numbered) on it. */
async function cropWithMarks(page: Buffer, W: number, H: number, window: ImageRegion, f: BlankFieldGeometry, outWidth: number, stroke: number): Promise<Buffer> {
  const left = Math.round(window.xPct * W), top = Math.round(window.yPct * H);
  const width = Math.max(1, Math.round(window.wPct * W)), height = Math.max(1, Math.round(window.hPct * H));
  const scale = outWidth / width;
  const fontPx = Math.max(11, Math.round(stroke * 5));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}">`;
  f.widgets.forEach((w, i) => {
    const r = normRegion(w.region);
    const x = (r.xPct * W - left) * scale, y = (r.yPct * H - top) * scale;
    const bw = r.wPct * W * scale, bh = r.hPct * H * scale;
    svg += `<rect x="${x - stroke}" y="${y - stroke}" width="${bw + 2 * stroke}" height="${bh + 2 * stroke}" fill="none" stroke="#ff00c8" stroke-width="${stroke}"/>`;
    if (f.widgets.length > 1) {
      svg += `<rect x="${x - stroke}" y="${y - stroke - fontPx - 2}" width="${fontPx + 6}" height="${fontPx + 2}" fill="#ff00c8"/>`;
      svg += `<text x="${x - stroke + 3}" y="${y - stroke - 3}" font-family="Arial" font-size="${fontPx}" font-weight="bold" fill="#fff">${i + 1}</text>`;
    }
  });
  svg += `</svg>`;
  return sharp(page)
    .extract({ left, top, width, height })
    .resize({ width: Math.round(width * scale) })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * One picture per box instead of three: close-up over wider view over whole page, each captioned.
 *
 * A naming helper opens the pictures one at a time and every new picture re-reads everything it has
 * already opened, so the bill grows with the SQUARE of how many pictures are in a batch. Three
 * pictures per box was costing ~160k tokens per box per pass, ~58% of it re-reads. Stacking them
 * into one keeps every pixel that made naming work and cuts the reads per batch threefold.
 */
async function buildComposite(tight: Buffer, wide: Buffer, pageThumb: Buffer): Promise<Buffer> {
  // A reader shrinks any picture whose long edge passes ~1568px, so a stack that runs off the
  // bottom costs detail in the close-up — the one panel the name is actually read from. Stack the
  // three panels while they fit; on a portrait sheet, put the page beside them instead.
  const MAX = 1500, GAP = 8, CAPH = 18;
  const CAP1 = "1. CLOSE-UP (this box is outlined in pink)";
  const CAP2 = "2. WIDER VIEW (same box, more of the sheet)";
  const CAP3 = "3. WHOLE PAGE (pink marker + crosshair = this box)";
  const fit = async (buf: Buffer, opts: { width?: number; height?: number }) => {
    const out = await sharp(buf).resize({ ...opts, withoutEnlargement: true }).toBuffer();
    const m = await sharp(out).metadata();
    return { buf: out, w: m.width ?? 1, h: m.height ?? 1 };
  };

  type Placed = { buf: Buffer; w: number; h: number; x: number; y: number; label: string };
  const t = await fit(tight, { width: 900 });
  const w = await fit(wide, { width: 1100 });
  const p = await fit(pageThumb, { width: 700 });

  let placed: Placed[];
  const stackW = Math.max(t.w, w.w, p.w);
  const stackH = 3 * CAPH + t.h + w.h + p.h + 2 * GAP;
  if (stackW <= MAX && stackH <= MAX) {
    let y = 0;
    placed = [{ ...t, label: CAP1 }, { ...w, label: CAP2 }, { ...p, label: CAP3 }].map((panel) => {
      const row = { ...panel, x: Math.round((stackW - panel.w) / 2), y: y + CAPH };
      y += CAPH + panel.h + GAP;
      return row;
    });
  } else {
    // Close-up over wider view on the left, whole page on the right.
    const leftW = Math.min(900, MAX - 500 - GAP);
    const lt = await fit(tight, { width: leftW });
    const lw = await fit(wide, { width: leftW });
    const leftH = 2 * CAPH + lt.h + lw.h + GAP;
    const rp = await fit(pageThumb, { width: MAX - leftW - GAP, height: Math.min(leftH - CAPH, MAX - CAPH) });
    placed = [
      { ...lt, label: CAP1, x: 0, y: CAPH },
      { ...lw, label: CAP2, x: 0, y: 2 * CAPH + lt.h + GAP },
      { ...rp, label: CAP3, x: leftW + GAP, y: CAPH },
    ];
  }

  const W = Math.max(...placed.map((x) => x.x + x.w));
  const H = Math.max(...placed.map((x) => x.y + x.h));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + placed.map((x) => `<text x="${x.x + 4}" y="${x.y - 5}" font-family="Arial" font-size="13" font-weight="bold" fill="#0a7">${x.label}</text>`).join("")
    + `</svg>`;
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite([...placed.map((x) => ({ input: x.buf, top: x.y, left: x.x })), { input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  if (Math.max(W, H) <= MAX) return out;
  return sharp(out).resize(W >= H ? { width: MAX } : { height: MAX }).jpeg({ quality: 88 }).toBuffer();
}

async function buildCrops(page: Buffer, W: number, H: number, f: BlankFieldGeometry, cropsDir?: string, composite = false): Promise<Crop> {
  const u = unionRegion(f);
  // Tight: the box plus roughly one column of neighbours each way — enough to read the printed
  // label and see the row/column it sits in. Wide: about a quarter page, for the section heading
  // and the diagram (front vs rear) the box belongs to.
  const tightWin = padded(u, Math.max(0.09, u.wPct * 1.2), Math.max(0.045, u.hPct * 2));
  const wideWin = padded(u, 0.24, 0.16);
  const tight = await cropWithMarks(page, W, H, tightWin, f, 900, 3);
  const wide = await cropWithMarks(page, W, H, wideWin, f, 1100, 4);
  // Whole page with the box marked heavily: the one picture that says FRONT block or REAR block,
  // left column or right — the axle mistakes v2.0 made came from never seeing the whole sheet.
  const pageThumb = await pageWithMarker(page, W, H, u);
  const box = composite ? await buildComposite(tight, wide, pageThumb) : undefined;
  if (cropsDir) {
    const safe = f.name.replace(/[^a-z0-9]+/gi, "_");
    if (box) writeFileSync(join(cropsDir, `${safe}-box.jpg`), box);
    else {
      writeFileSync(join(cropsDir, `${safe}-tight.jpg`), tight);
      writeFileSync(join(cropsDir, `${safe}-wide.jpg`), wide);
      writeFileSync(join(cropsDir, `${safe}-page.jpg`), pageThumb);
    }
  }
  return {
    tight: `data:image/jpeg;base64,${tight.toString("base64")}`,
    wide: `data:image/jpeg;base64,${wide.toString("base64")}`,
    page: `data:image/jpeg;base64,${pageThumb.toString("base64")}`,
    ...(box ? { box: `data:image/jpeg;base64,${box.toString("base64")}` } : {}),
  };
}

async function pageWithMarker(page: Buffer, W: number, H: number, u: ImageRegion): Promise<Buffer> {
  const outW = 700, s = outW / W, outH = Math.round(H * s);
  const x = u.xPct * W * s, y = u.yPct * H * s, bw = Math.max(6, u.wPct * W * s), bh = Math.max(6, u.hPct * H * s);
  const pad = 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">`
    + `<rect x="${x - pad}" y="${y - pad}" width="${bw + 2 * pad}" height="${bh + 2 * pad}" fill="rgba(255,0,200,0.25)" stroke="#ff00c8" stroke-width="5"/>`
    + `<line x1="0" y1="${y + bh / 2}" x2="${outW}" y2="${y + bh / 2}" stroke="#ff00c8" stroke-width="1.5" stroke-dasharray="6 6"/>`
    + `<line x1="${x + bw / 2}" y1="0" x2="${x + bw / 2}" y2="${outH}" stroke="#ff00c8" stroke-width="1.5" stroke-dasharray="6 6"/>`
    + `</svg>`;
  return sharp(page).resize({ width: outW }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
}

// ---------- layout: the sheet's printed blocks, once per sheet ----------

export type LayoutBlock = { label: string; axle: "front" | "rear" | "both" | "none"; region: ImageRegion };

/**
 * One call with the whole page: where are the printed blocks (FRONT, REAR, SHOCKS, TRANSMISSION,
 * header, …) and which axle does each govern. The per-box calls are then TOLD which block a box
 * lies in instead of being trusted to work it out — v2.1 on the MTC3 still named rear-half boxes
 * "front" because a rear upright drawing looks like a front one up close.
 */
/**
 * The whole page with a labelled 0.1 grid drawn over it. Without the grid the reader's fractions
 * drift (the Mi10's FRONT block came back 0.14 of the page too low, so every rear box was told it
 * was front). With it, the coordinates get read off rather than guessed.
 */
export async function gridOverlayJpeg(page: Buffer, W: number, H: number, gw = 1600): Promise<Buffer> {
  const gs = gw / W, gh = Math.round(H * gs);
  let grid = `<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${gh}">`;
  for (let i = 1; i < 10; i++) {
    const x = (i / 10) * gw, y = (i / 10) * gh;
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${gh}" stroke="#00a0ff" stroke-width="2" stroke-dasharray="10 8"/>`;
    grid += `<line x1="0" y1="${y}" x2="${gw}" y2="${y}" stroke="#00a0ff" stroke-width="2" stroke-dasharray="10 8"/>`;
    for (const yy of [14, gh - 6]) grid += `<text x="${x + 4}" y="${yy}" font-family="Arial" font-size="22" font-weight="bold" fill="#0060c0">x=0.${i}</text>`;
    for (const xx of [4, gw - 80]) grid += `<text x="${xx}" y="${y - 6}" font-family="Arial" font-size="22" font-weight="bold" fill="#0060c0">y=0.${i}</text>`;
  }
  grid += `</svg>`;
  return sharp(page).resize({ width: gw, withoutEnlargement: true }).composite([{ input: Buffer.from(grid), top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer();
}

async function detectLayout(input: { apiKey: string; model: string; page: Buffer; W: number; H: number; carName: string; timeoutMs: number }): Promise<LayoutBlock[]> {
  const img = await gridOverlayJpeg(input.page, input.W, input.H);
  const isReasoning = /^gpt-5|^o[0-9]/.test(input.model);
  // Reasoning tokens count against max_completion_tokens: 6000 at medium effort came back as an
  // empty body ("Unexpected end of JSON input") on both test sheets.
  const params = isReasoning ? { max_completion_tokens: 24000, reasoning_effort: "medium" } : { temperature: 0, max_tokens: 8000 };
  const sys = `You are mapping the printed layout of a BLANK RC car setup sheet. Return every printed block or section of the page as a rectangle in page fractions (x grows right, y grows DOWN, 0..1), with the heading printed on it. A blue dashed grid is drawn on the picture every 0.1 with its x= and y= values printed at the edges — READ every coordinate off that grid (a heading just under the y=0.2 line is at y≈0.21, not 0.3). Be exact: a wrong rectangle mislabels every box inside it. A "block" is an area governed by one heading: e.g. a FRONT suspension area, a REAR suspension area, SHOCKS, TRANSMISSION / DRIVETRAIN, TIRES, ELECTRONICS, CHASSIS / TOP DECK, BODY, the header strip (driver/track/date), NOTES. Many sheets are split into a FRONT half and a REAR half with the words FRONT and REAR printed at an edge — those halves are blocks too, and usually the most important ones. Set axle to "front" when the block belongs to the front end of the car, "rear" for the rear end, "both" when it holds both (e.g. a SHOCKS block with front and rear columns — then ALSO return the front column and rear column as their own smaller blocks), "none" when the axle does not apply.
Return ONLY JSON: {"blocks":[{"label": string, "axle": "front"|"rear"|"both"|"none", "x": number, "y": number, "w": number, "h": number}]}. Cover the whole page; blocks may nest (a REAR half containing a REAR SHOCK column) — return both the big and the small.`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: input.model, ...params, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: [{ type: "text", text: `Car: ${input.carName}. Map the printed blocks of this sheet.` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${img.toString("base64")}`, detail: "high" } }] }] }),
    });
    if (!res.ok) throw new Error(`layout call failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const body = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!body) throw new Error(`layout call returned no body (finish_reason=${json.choices?.[0]?.finish_reason ?? "?"})`);
    const raw = JSON.parse(body) as { blocks?: unknown[] };
    const out: LayoutBlock[] = [];
    for (const b of raw.blocks ?? []) {
      if (!b || typeof b !== "object") continue;
      const o = b as Record<string, unknown>;
      const num = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : NaN);
      const x = num("x"), y = num("y"), w = num("w"), h = num("h");
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      const axle = o.axle === "front" || o.axle === "rear" || o.axle === "both" ? o.axle : "none";
      out.push({ label: typeof o.label === "string" ? o.label.trim() : "", axle, region: { xPct: Math.max(0, x), yPct: Math.max(0, y), wPct: Math.min(1, w), hPct: Math.min(1, h) } });
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

/** The smallest layout blocks containing the box's centre, innermost first. */
function blocksFor(layout: LayoutBlock[], u: ImageRegion): LayoutBlock[] {
  const cx = u.xPct + u.wPct / 2, cy = u.yPct + u.hPct / 2;
  return layout
    .filter((b) => cx >= b.region.xPct && cx <= b.region.xPct + b.region.wPct && cy >= b.region.yPct && cy <= b.region.yPct + b.region.hPct)
    .sort((a, b) => a.region.wPct * a.region.hPct - b.region.wPct * b.region.hPct);
}

/** Front/rear as the PDF author named the field ("Rear Toe", "fr-shock-oil", "rr_camber"). */
function axleFromFieldName(name: string): "front" | "rear" | null {
  const n = name.toLowerCase();
  if (/\b(rear|rr|rl|rh?_|bk)\b|^r[-_ ]|^re[-_]|[-_ ]r$|rear/.test(n) && !/front|^f[-_ ]|\bfr\b/.test(n)) return "rear";
  if (/\b(front|ff|fl|fr)\b|^f[-_ ]|[-_ ]f$|front/.test(n) && !/rear|^r[-_ ]|[-_ ]r$/.test(n)) return "front";
  return null;
}

function layoutHint(layout: LayoutBlock[], f: BlankFieldGeometry): string {
  const u = unionRegion(f);
  const named = axleFromFieldName(f.name);
  const inside = blocksFor(layout, u);
  const axleBlock = inside.find((b) => b.axle === "front" || b.axle === "rear");
  const parts: string[] = [];
  if (inside.length === 0) parts.push("Layout: this box is outside every mapped block.");
  else parts.push(`Layout: this box sits in ${inside.slice(0, 3).map((b) => `"${b.label}"`).join(" inside ")}.`);
  if (named) parts.push(`The PDF author named this field "${f.name}" — that says ${named.toUpperCase()}, and the author's name outranks the layout.`);
  else if (axleBlock) parts.push(`The sheet's layout puts it in the ${axleBlock.axle.toUpperCase()} block ("${axleBlock.label}") — so this is a ${axleBlock.axle} parameter unless the print beside the box says otherwise.`);
  return parts.join(" ");
}

// ---------- model ----------

type Labeled = {
  name: string;
  printedLabel: string;
  displayLabel: string;
  section: string;
  fieldKind: "text" | "choice" | "multi";
  options?: Array<{ widgetIndex: number; label: string }>;
  universalParameterId?: string;
  confidence: number;
  /** A lone tick box that is one option of a set spread over separate PDF fields. */
  optionSetName?: string;
  optionLabel?: string;
};

function systemPrompt(): string {
  const registry = universalParameterCatalogForPrompt().map((p) => `  ${p.id} — ${p.label}`).join("\n");
  return `You are naming the input boxes of a BLANK RC car setup sheet (touring car or off-road buggy/truggy — the car name tells you which) so a driver's filled-in values can be imported as real setup parameters.

For EACH field you get three pictures. "close-up": the box outlined in magenta with the print around it. "context": a wider view of the same area, same magenta outline, showing the section heading and any diagram the box belongs to. "whole page": the entire sheet with the box filled magenta and a dashed crosshair through it. For a tick group the boxes are numbered 1..n in magenta; those numbers are widget positions, not printed text.

Rules:
- Read the PRINTED label on or beside the outlined box. Do not guess from position alone. If the box sits in a diagram, follow its leader line and name the part.
- FRONT or REAR: each field comes with a "Layout:" line saying which printed block of the sheet the box sits in (mapped from the whole page beforehand). OBEY IT. Setup sheets repeat the same boxes for both ends and a rear upright drawing looks like a front one up close — the layout line and the whole-page crosshair are the truth, the close-up is not. Only override the layout when the print directly beside the box names the other end (e.g. a "REAR" word on the box itself). Left/right and per-corner likewise.
- printedLabel: the exact printed words nearest the box (e.g. "RIDE HEIGHT", "OIL", "48"). "" if none.
- displayLabel: what a driver would call it WITHOUT the sheet — resolve front/rear, left/right, which corner, which shock, from the context picture (e.g. "Rear ride height (mm)", "Front shock oil (cSt)", "Camber link — rear, inner shim (mm)"). Keep printed units. Two different boxes must never get the same displayLabel: if the sheet has one box per corner or per side, say which.
- section: the printed section heading this box sits under, in Title Case ("Front", "Rear", "Shocks", "Transmission", "Header", "Tyres", "Electronics", "Chassis", "Notes"...).
- fieldKind: "text" for a written value; for tick boxes "choice" when one gets marked, "multi" when several commonly do.
- options: for tick groups ONLY — one entry per numbered box: {"widgetIndex": <number shown minus 1>, "label": <the printed word beside THAT box>}. Every number must appear once.
- A LONE tick box (one box, not numbered) is usually one option of a set drawn as separate boxes ("LOW / MED / HIGH", "YES / NO", "ARM / AXLE"). Then set optionSetName to the set's name as a driver would say it ("Traction", "Front droop reference") and optionLabel to THIS box's printed word. displayLabel stays the set name.
- universalParameterId: REQUIRED when the box is one of these cross-car concepts; use the id EXACTLY; omit for car-specific boxes. Match the axle: a rear box never gets a *_front id.
- confidence: 0..1, your honest probability the displayLabel is what a careful human would write. Below 0.6 when the print is ambiguous or the box could belong to two things.

Universal parameters:
${registry}

Return ONLY JSON: {"fields":[{"name","printedLabel","displayLabel","section","fieldKind","options"?,"optionSetName"?,"optionLabel"?,"universalParameterId"?,"confidence"}]} covering every field given, name echoed exactly.`;
}

function where(r: ImageRegion): string {
  const col = r.xPct < 0.33 ? "left" : r.xPct < 0.66 ? "centre" : "right";
  const row = r.yPct < 0.2 ? "top" : r.yPct < 0.45 ? "upper" : r.yPct < 0.7 ? "lower" : "bottom";
  return `${row} ${col} of the page`;
}

type BatchItem = { f: BlankFieldGeometry; crop: Crop; hint: string };

async function callModel(input: { apiKey: string; model: string; carName: string; batch: BatchItem[]; timeoutMs: number }): Promise<Labeled[]> {
  const content: Array<Record<string, unknown>> = [];
  content.push({ type: "text", text: `Car: ${input.carName}. Name these ${input.batch.length} fields.` });
  for (const { f, crop, hint } of input.batch) {
    const u = unionRegion(f);
    content.push({ type: "text", text: `Field name: ${f.name} — ${f.kind === "checkbox" ? (f.widgets.length > 1 ? `tick group of ${f.widgets.length} boxes` : "lone tick box") : "written value"}, ${where(u)}. ${hint} Close-up:` });
    content.push({ type: "image_url", image_url: { url: crop.tight, detail: "high" } });
    content.push({ type: "text", text: `Context for ${f.name}:` });
    content.push({ type: "image_url", image_url: { url: crop.wide, detail: "high" } });
    content.push({ type: "text", text: `Whole page for ${f.name} (box marked in magenta, dashed crosshair through it) — use it to decide FRONT vs REAR, left vs right, and the section:` });
    content.push({ type: "image_url", image_url: { url: crop.page, detail: "low" } });
  }
  const isReasoning = /^gpt-5|^o[0-9]/.test(input.model);
  const params = isReasoning ? { max_completion_tokens: 12000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 12000 };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: input.model, ...params, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt() }, { role: "user", content }] }),
    });
    if (!res.ok) throw new Error(`naming call failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    const raw = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}") as { fields?: unknown[] };
    const out: Labeled[] = [];
    for (const item of raw.fields ?? []) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const name = typeof f.name === "string" ? f.name.trim() : "";
      if (!name) continue;
      const options: Labeled["options"] = [];
      (Array.isArray(f.options) ? f.options : []).forEach((o, idx) => {
        if (typeof o === "string") { if (o.trim()) options.push({ widgetIndex: idx, label: o.trim() }); return; }
        if (!o || typeof o !== "object") return;
        const oo = o as Record<string, unknown>;
        const wi = [oo.widgetIndex, oo.index, oo.i].find((v) => typeof v === "number");
        const label = typeof oo.label === "string" ? oo.label.trim() : typeof oo.value === "string" ? oo.value.trim() : "";
        if (label) options.push({ widgetIndex: typeof wi === "number" ? wi : idx, label });
      });
      const str = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
      out.push({
        name,
        printedLabel: str("printedLabel"),
        displayLabel: str("displayLabel") || name,
        section: str("section"),
        fieldKind: f.fieldKind === "choice" || f.fieldKind === "multi" ? f.fieldKind : "text",
        ...(options.length ? { options } : {}),
        ...(str("universalParameterId") ? { universalParameterId: str("universalParameterId") } : {}),
        confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
        ...(str("optionSetName") ? { optionSetName: str("optionSetName") } : {}),
        ...(str("optionLabel") ? { optionLabel: str("optionLabel") } : {}),
      });
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

// ---------- assembly (mirrors v1 so the result plugs into the same places) ----------

function keyFromAcroName(name: string, seen: Set<string>): string {
  let key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) key = "field";
  while (seen.has(key)) key = `${key}_2`;
  seen.add(key);
  return key;
}

function expandTextRegion(r: ImageRegion): ImageRegion {
  const padX = r.wPct * 0.08, padY = r.hPct * 0.3;
  const x = Math.max(0, r.xPct - padX), y = Math.max(0, r.yPct - padY);
  const right = Math.min(1, r.xPct + r.wPct + padX), bottom = Math.min(1, r.yPct + r.hPct + padY);
  return { xPct: x, yPct: y, wPct: Math.max(0, right - x), hPct: Math.max(0, bottom - y) };
}

async function dHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf).removeAlpha().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let hex = "";
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push((data[y * 9 + x] ?? 0) < (data[y * 9 + x + 1] ?? 0) ? 1 : 0);
  for (let i = 0; i < bits.length; i += 4) hex += ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!).toString(16);
  return hex;
}

export type V2Field = DraftedField & { confidence: number; printedLabel: string; pdfFieldNames: string[] };

export type V2Result = {
  draftedSchema: DraftedSchema & { fields: V2Field[] };
  imageCalibration: ImageCalibration;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  geometry: BlankAcroFormGeometry;
  layout: LayoutBlock[];
  warnings: string[];
  labeledRaw: Labeled[];
};

function assemble(input: { geometry: BlankAcroFormGeometry; labeled: Map<string, Labeled>; carName: string; model: string; widthPx: number; heightPx: number; pHash64: string; warnings: string[]; layout: LayoutBlock[] }): V2Result {
  const { geometry, labeled, warnings } = input;
  const seen = new Set<string>();
  const fields: V2Field[] = [];
  const calFields: ImageCalibrationField[] = [];
  const mappings: Record<string, PdfFormFieldMappingRule> = {};

  // Lone tick boxes that name the same option set, close together on the page, become ONE
  // pick-one group spread over named fields — the sheet's meaning, and the reader's group mode.
  const loneSets = new Map<string, BlankFieldGeometry[]>();
  const consumed = new Set<string>();
  for (const g of geometry.fields) {
    if (g.kind !== "checkbox" || g.widgets.length !== 1) continue;
    const l = labeled.get(g.name);
    if (!l?.optionSetName || !l.optionLabel) continue;
    const setKey = `${l.section.toLowerCase()}|${l.optionSetName.toLowerCase()}`;
    (loneSets.get(setKey) ?? loneSets.set(setKey, []).get(setKey)!).push(g);
  }
  for (const [setKey, members] of loneSets) {
    if (members.length < 2) continue;
    // Proximity guard: every member within ~12% of the page of the set's centroid.
    const cx = members.reduce((s, m) => s + m.widgets[0]!.region.xPct, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.widgets[0]!.region.yPct, 0) / members.length;
    const near = members.filter((m) => Math.abs(m.widgets[0]!.region.xPct - cx) < 0.12 && Math.abs(m.widgets[0]!.region.yPct - cy) < 0.12);
    if (near.length < 2) continue;
    const first = labeled.get(near[0]!.name)!;
    const key = keyFromAcroName(first.optionSetName!, seen);
    const optionLabels = near.map((m) => labeled.get(m.name)!.optionLabel!);
    if (new Set(optionLabels.map((s) => s.toLowerCase())).size !== optionLabels.length) { warnings.push(`lone_set_duplicate_labels:${setKey}`); continue; }
    const uni = first.universalParameterId || suggestUniversalParameterId(key, first.optionSetName) || undefined;
    fields.push({ key, displayLabel: first.optionSetName!, section: first.section, valueType: "choice", options: optionLabels, ...(uni ? { universalParameterId: uni } : {}), confidence: Math.min(...near.map((m) => labeled.get(m.name)!.confidence)), printedLabel: optionLabels.join(" / "), pdfFieldNames: near.map((m) => m.name) });
    const optionRefs: Record<string, { pdfFieldName: string; widgetInstanceIndex?: number }> = {};
    near.forEach((m, i) => { optionRefs[optionLabels[i]!] = { pdfFieldName: m.name, widgetInstanceIndex: 0 }; });
    mappings[key] = { mode: "singleChoiceNamedFields", options: optionRefs } as unknown as PdfFormFieldMappingRule;
    calFields.push({ kind: "singleChoiceGroup", key, options: near.map((m, i) => ({ value: optionLabels[i]!, region: m.widgets[0]!.region })), minWinnerDarkness: 0.3, minMargin: 0.05 });
    for (const m of near) consumed.add(m.name);
  }

  for (const geo of geometry.fields) {
    if (consumed.has(geo.name)) continue;
    const l = labeled.get(geo.name);
    if (!l) warnings.push(`unlabeled_field:${geo.name}`);
    const key = keyFromAcroName(geo.name, seen);
    const displayLabel = l?.displayLabel || geo.name;
    const section = l?.section || "";
    const uni = l?.universalParameterId || suggestUniversalParameterId(key, displayLabel) || undefined;
    const base = { key, displayLabel, section, ...(uni ? { universalParameterId: uni } : {}), confidence: l?.confidence ?? 0, printedLabel: l?.printedLabel ?? "", pdfFieldNames: [geo.name] };

    if (geo.kind === "text") {
      fields.push({ ...base, valueType: "text" });
      calFields.push({ kind: "text", key, region: expandTextRegion(normRegion(geo.widgets[0]!.region)) });
      mappings[key] = { mode: "acroField", pdfFieldName: geo.name } as PdfFormFieldMappingRule;
      continue;
    }
    const byWidget = new Map<number, string>();
    for (const o of l?.options ?? []) if (!byWidget.has(o.widgetIndex)) byWidget.set(o.widgetIndex, o.label);
    const optionLabels = geo.widgets.map((w) => {
      const label = byWidget.get(w.widgetIndex) ?? (geo.widgets.length === 1 ? l?.optionLabel : undefined);
      if (!label) { warnings.push(`option_label_missing:${geo.name}#${w.widgetIndex}`); return `option_${w.widgetIndex + 1}`; }
      return label;
    });
    if (new Set(optionLabels.map((s) => s.toLowerCase())).size !== optionLabels.length) warnings.push(`option_labels_duplicated:${geo.name}`);

    if (geo.widgets.length === 1) {
      fields.push({ ...base, valueType: "choice", options: [optionLabels[0]!] });
      calFields.push({ kind: "checkbox", key, region: geo.widgets[0]!.region, checkedValue: optionLabels[0]!, uncheckedValue: "" });
      mappings[key] = { mode: "acroField", pdfFieldName: geo.name } as PdfFormFieldMappingRule;
      continue;
    }
    fields.push({ ...base, valueType: "choice", options: optionLabels });
    const instanceIndexByGeometryIndex = widgetInstanceIndexByGeometryIndex(geo.widgets);
    const optionRefs: Record<string, PdfFormWidgetInstanceRef> = {};
    geo.widgets.forEach((w, i) => {
      const idx = instanceIndexByGeometryIndex.get(w.widgetIndex);
      if (idx != null && !(optionLabels[i]! in optionRefs)) optionRefs[optionLabels[i]!] = { widgetInstanceIndex: idx };
    });
    mappings[key] = { mode: l?.fieldKind === "multi" ? "multiSelectWidgetGroup" : "singleChoiceWidgetGroup", pdfFieldName: geo.name, options: optionRefs } as PdfFormFieldMappingRule;
    if (l?.fieldKind === "multi") calFields.push({ kind: "multiSelectGroup", key, options: geo.widgets.map((w, i) => ({ value: optionLabels[i]!, region: w.region })), minWinnerDarkness: 0.32 });
    else calFields.push({ kind: "singleChoiceGroup", key, options: geo.widgets.map((w, i) => ({ value: optionLabels[i]!, region: w.region })), minWinnerDarkness: 0.3, minMargin: 0.05 });
  }

  return {
    draftedSchema: { version: 1, carName: input.carName, fields, universalMappedCount: fields.filter((f) => f.universalParameterId).length, model: input.model, warnings },
    imageCalibration: { reference: { exampleDocumentId: BLANK_REFERENCE_DOCUMENT_ID, widthPx: input.widthPx, heightPx: input.heightPx, pHash64: input.pHash64, headerTokens: [] }, fields: calFields },
    formFieldMappings: mappings,
    geometry,
    layout: input.layout,
    warnings,
    labeledRaw: [...labeled.values()],
  };
}

// ---------- main ----------

export async function draftBlankV2(input: {
  pdfBytes: Buffer; carName: string; apiKey: string; model: string; perCall: number; concurrency: number; scale: number; cropsDir?: string; limit?: number; log?: (s: string) => void;
  /** Stack each box's three pictures into one, so a helper opens one picture per box, not three. */
  composite?: boolean;
  /** Stop after the crops and write a manifest (field list + crop paths) for a human or another model to name. Returns null. */
  manifestPath?: string;
  /** Skip the model: read a Labeled[] JSON produced from the manifest and assemble the result. */
  labelsPath?: string;
  /** Name only these PDF fields (re-runs after a crop fix). */
  only?: string[];
}): Promise<V2Result | null> {
  const log = input.log ?? (() => {});
  const geometry = await parseBlankAcroFormGeometry(input.pdfBytes);
  if (geometry.fields.length === 0) throw new Error("no AcroForm fields");
  const page = await renderPdfFirstPageToPng(new Uint8Array(input.pdfBytes), { scale: input.scale });
  const meta = await sharp(page).metadata();
  const W = meta.width!, H = meta.height!;
  let fields = input.limit ? geometry.fields.slice(0, input.limit) : geometry.fields;
  if (input.only && input.only.length) {
    const want = new Set(input.only);
    fields = fields.filter((f) => want.has(f.name));
  }
  log(`geometry: ${geometry.fields.length} fields (${fields.length} to name), page ${W}x${H}`);

  const t0 = Date.now();
  let layout: LayoutBlock[] = [];
  const warnings: string[] = [];
  const offline = Boolean(input.manifestPath || input.labelsPath);
  if (offline) log("offline mode: no model calls (layout is the namer's job)");
  try {
    if (offline) throw new Error("skipped");
    layout = await detectLayout({ apiKey: input.apiKey, model: input.model, page, W, H, carName: input.carName, timeoutMs: 240000 });
    log(`layout: ${layout.length} blocks — ${layout.map((b) => `${b.label}[${b.axle}]`).join(", ")}`);
    if (!layout.some((b) => b.axle === "front") || !layout.some((b) => b.axle === "rear")) warnings.push("layout_missing_axle_block");
    // Self-check: where the PDF author's field names say front/rear, the layout must agree. A
    // layout that contradicts more than a quarter of the named fields is mis-drawn (the Mi10's
    // blocks once came back slid 0.14 down the page) — drop its axle claims rather than spread them.
    let named = 0, conflicts = 0;
    for (const f of fields) {
      const a = axleFromFieldName(f.name);
      if (!a) continue;
      const b = blocksFor(layout, unionRegion(f)).find((x) => x.axle === "front" || x.axle === "rear");
      if (!b) continue;
      named++;
      if (b.axle !== a) conflicts++;
    }
    if (named >= 8 && conflicts / named > 0.25) {
      warnings.push(`layout_contradicts_field_names:${conflicts}/${named}_axle_blocks_dropped`);
      log(`layout contradicts ${conflicts}/${named} named fields — dropping its front/rear claims`);
      layout = layout.map((b) => (b.axle === "front" || b.axle === "rear" ? { ...b, axle: "none" as const } : b));
    } else if (named) log(`layout agrees with ${named - conflicts}/${named} named fields`);
  } catch (e) {
    warnings.push(`layout_failed:${(e as Error).message.slice(0, 100)}`);
    log(`layout failed: ${(e as Error).message.slice(0, 200)}`);
  }
  const crops: BatchItem[] = [];
  for (const f of fields) crops.push({ f, crop: await buildCrops(page, W, H, f, input.cropsDir, input.composite), hint: layoutHint(layout, f) });
  log(`crops built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (input.manifestPath) {
    if (!input.cropsDir) throw new Error("--manifest needs --crops so the pictures land on disk");
    const safe = (n: string) => n.replace(/[^a-z0-9]+/gi, "_");
    const manifest = {
      carName: input.carName, page: { widthPx: W, heightPx: H },
      universalParameters: universalParameterCatalogForPrompt().map((p) => ({ id: p.id, label: p.label })),
      fields: fields.map((f) => {
        const u = unionRegion(f);
        return {
          name: f.name, kind: f.kind, widgets: f.widgets.length, where: where(u), nameSaysAxle: axleFromFieldName(f.name),
          region: { x: +u.xPct.toFixed(3), y: +u.yPct.toFixed(3), w: +u.wPct.toFixed(3), h: +u.hPct.toFixed(3) },
          // One rect per widget, in widgetIndex order (the order the pictures number them 1..n), so a
          // whole-drawing picture can outline and tag every tick box of a group, not just its union.
          widgetRegions: f.widgets.map((w) => {
            const r = normRegion(w.region);
            return { x: +r.xPct.toFixed(4), y: +r.yPct.toFixed(4), w: +r.wPct.toFixed(4), h: +r.hPct.toFixed(4) };
          }),
          ...(input.composite
            ? { box: join(input.cropsDir!, `${safe(f.name)}-box.jpg`) }
            : { tight: join(input.cropsDir!, `${safe(f.name)}-tight.jpg`), wide: join(input.cropsDir!, `${safe(f.name)}-wide.jpg`), page: join(input.cropsDir!, `${safe(f.name)}-page.jpg`) }),
        };
      }),
    };
    writeFileSync(input.manifestPath, JSON.stringify(manifest, null, 2));
    log(`manifest written: ${fields.length} fields → ${input.manifestPath}`);
    return null;
  }

  if (input.labelsPath) {
    const raw = JSON.parse(readFileSync(input.labelsPath, "utf8")) as { fields?: Labeled[] } | Labeled[];
    const list = Array.isArray(raw) ? raw : raw.fields ?? [];
    const labeled = new Map<string, Labeled>();
    for (const l of list) if (l && typeof l.name === "string" && !labeled.has(l.name)) labeled.set(l.name, { ...l, confidence: typeof l.confidence === "number" ? l.confidence : 0.5, fieldKind: l.fieldKind ?? "text", printedLabel: l.printedLabel ?? "", section: l.section ?? "", displayLabel: l.displayLabel || l.name });
    log(`labels read: ${labeled.size} of ${fields.length} fields`);
    const sub = { ...geometry, fields };
    return assemble({ geometry: sub, labeled, carName: input.carName, model: input.model, widthPx: W, heightPx: H, pHash64: await dHash(page), warnings, layout });
  }

  const batches: Array<typeof crops> = [];
  for (let i = 0; i < crops.length; i += input.perCall) batches.push(crops.slice(i, i + input.perCall));
  const labeled = new Map<string, Labeled>();
  let cursor = 0, done = 0;
  const workers = Array.from({ length: Math.min(input.concurrency, batches.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= batches.length) return;
      const batch = batches[i]!;
      let out: Labeled[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try { out = await callModel({ apiKey: input.apiKey, model: input.model, carName: input.carName, batch, timeoutMs: 240000 }); break; }
        catch (e) { if (attempt === 2) { warnings.push(`batch_failed:${i}:${(e as Error).message.slice(0, 120)}`); log(`batch ${i} failed: ${(e as Error).message.slice(0, 200)}`); } else await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); }
      }
      for (const l of out) if (!labeled.has(l.name)) labeled.set(l.name, l);
      done++;
      log(`batch ${done}/${batches.length} done (${labeled.size} named, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  });
  await Promise.all(workers);

  // Repair: anything dropped or with incomplete option coverage gets one focused retry.
  const needsRepair = crops.filter(({ f }) => {
    const l = labeled.get(f.name);
    if (!l) return true;
    if (f.kind !== "checkbox" || f.widgets.length === 1) return false;
    const covered = new Set((l.options ?? []).map((o) => o.widgetIndex));
    return !f.widgets.every((w) => covered.has(w.widgetIndex));
  });
  if (needsRepair.length) {
    log(`repair pass: ${needsRepair.length} fields`);
    for (let i = 0; i < needsRepair.length; i += input.perCall) {
      try {
        for (const l of await callModel({ apiKey: input.apiKey, model: input.model, carName: input.carName, batch: needsRepair.slice(i, i + input.perCall), timeoutMs: 240000 })) {
          const ex = labeled.get(l.name);
          if (!ex || (l.options?.length ?? 0) > (ex.options?.length ?? 0)) labeled.set(l.name, l);
        }
      } catch (e) { warnings.push(`repair_failed:${(e as Error).message.slice(0, 100)}`); }
    }
  }

  const sub = { ...geometry, fields };
  return assemble({ geometry: sub, labeled, carName: input.carName, model: input.model, widthPx: W, heightPx: H, pHash64: await dHash(page), warnings, layout });
}

async function main() {
  const pdfPath = arg("pdf"), carName = arg("car") ?? "Unknown car", outPath = arg("out");
  if (!pdfPath || !outPath) throw new Error("--pdf and --out are required");
  const manifestPath = arg("manifest"), labelsPath = arg("labels");
  const apiKey = getOpenAiApiKey() ?? "";
  if (!apiKey && !manifestPath && !labelsPath) throw new Error("no OpenAI key in env");
  const cropsDir = arg("crops");
  if (cropsDir && !existsSync(cropsDir)) mkdirSync(cropsDir, { recursive: true });
  const result = await draftBlankV2({
    pdfBytes: readFileSync(pdfPath), carName, apiKey,
    model: arg("model") ?? (labelsPath ? "claude-fable-5-1 (session)" : "gpt-5"),
    perCall: Number(arg("per-call") ?? 6), concurrency: Number(arg("concurrency") ?? 4), scale: Number(arg("scale") ?? 3),
    cropsDir, limit: arg("limit") ? Number(arg("limit")) : undefined,
    composite: process.argv.includes("--no-composite") ? false : Boolean(arg("manifest")),
    manifestPath, labelsPath,
    only: arg("only-file") ? (JSON.parse(readFileSync(arg("only-file")!, "utf8")) as string[]) : undefined,
    log: (s) => console.log(s),
  });
  if (!result) return;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  const f = result.draftedSchema.fields as V2Field[];
  const lowConf = f.filter((x) => x.confidence < 0.6).length;
  console.log(`\n${f.length} fields · ${f.filter((x) => x.valueType === "choice").length} tick groups · ${result.draftedSchema.universalMappedCount} universal · ${lowConf} low-confidence · warnings ${result.warnings.length}`);
  if (result.warnings.length) console.log(result.warnings.slice(0, 20).join("\n"));
}

if (process.argv[1] && /draft-blank-v2\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
