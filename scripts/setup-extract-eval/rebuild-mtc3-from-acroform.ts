/**
 * Rebuild the MTC3 image-calibration REGIONS from the editable AcroForm PDF's exact widget
 * rectangles, keyed via the existing calibration's formFieldMappings (schemaKey -> pdfFieldName).
 * Preserves schema keys, group option values, and the whole PDF calibration; only replaces
 * imageCalibration geometry + tunes choice-group darkness gates.
 *
 * SAFE BY DEFAULT (dry-run): builds, renders an overlay, and test-reads a filled image offline.
 * --apply writes only calibrationDataJson.imageCalibration back to the SAME calibration row.
 *
 *   Dry-run + overlay + test-read: npm-run via dotenv; -- --filled="C:/.../mugen test setup.jpg"
 *   Apply:                          -- --filled="..." --apply
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PDFDocument, PDFCheckBox, PDFRadioGroup } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { normalizeCalibrationData, normalizeImageCalibration } from "@/lib/setupCalibrations/types";
import type { ImageCalibration, ImageCalibrationField, ImageRegion } from "@/lib/setupCalibrations/types";

const CAL_ID = "cmpotp4qv0001l5043rtj9q70";
const MODEL_ID = "cmpor11xo0001jj04j420ik83";
const EDITABLE_PDF = "C:/Users/Jordan/Downloads/MTC3_EditableSetupSheet_CW.pdf";
const APPLY = process.argv.includes("--apply");
const RESULTS = join(process.cwd(), "scripts", "setup-extract-eval", "results");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

type WidgetRect = ImageRegion;
type AcroField = { name: string; kind: "text" | "checkbox"; widgets: WidgetRect[] };

async function acroGeometry(): Promise<Map<string, AcroField>> {
  const pdf = await PDFDocument.load(readFileSync(EDITABLE_PDF), { ignoreEncryption: true });
  const page = pdf.getPage(0);
  const { width: PW, height: PH } = page.getSize();
  const map = new Map<string, AcroField>();
  for (const f of pdf.getForm().getFields()) {
    const kind: AcroField["kind"] = f instanceof PDFCheckBox || f instanceof PDFRadioGroup ? "checkbox" : "text";
    const widgets = f.acroField.getWidgets().map((w) => {
      const r = w.getRectangle();
      return { xPct: r.x / PW, yPct: (PH - (r.y + r.height)) / PH, wPct: r.width / PW, hPct: r.height / PH };
    });
    map.set(f.getName(), { name: f.getName(), kind, widgets });
  }
  return map;
}

function expandText(r: WidgetRect): ImageRegion {
  const padX = r.wPct * 0.08, padY = r.hPct * 0.3;
  const x = Math.max(0, r.xPct - padX), y = Math.max(0, r.yPct - padY);
  const right = Math.min(1, r.xPct + r.wPct + padX), bottom = Math.min(1, r.yPct + r.hPct + padY);
  return { xPct: x, yPct: y, wPct: Math.max(0, right - x), hPct: Math.max(0, bottom - y) };
}

/** Pair existing option values (in their listed order) to AcroForm widgets sorted the same way
 *  the widgets read on the sheet (top-to-bottom, then left-to-right), preserving semantic order
 *  by falling back to existing-region order when counts match. */
function pairOptions(
  existing: Array<{ value: string; region: ImageRegion }>,
  widgets: WidgetRect[]
): { options: Array<{ value: string; region: ImageRegion }>; ok: boolean } {
  if (existing.length !== widgets.length) return { options: existing, ok: false };
  // Order both by reading order of their CENTERS, then zip. Existing regions are only drifted,
  // not reordered, so their relative reading order matches the widgets'.
  const order = (regs: ImageRegion[]) =>
    regs.map((r, i) => ({ i, cx: r.xPct + r.wPct / 2, cy: r.yPct + r.hPct / 2 }))
      .sort((a, b) => (Math.abs(a.cy - b.cy) > 0.012 ? a.cy - b.cy : a.cx - b.cx))
      .map((o) => o.i);
  const eOrder = order(existing.map((e) => e.region));
  const wOrder = order(widgets);
  const options = existing.map((e) => ({ ...e }));
  for (let rank = 0; rank < eOrder.length; rank++) {
    options[eOrder[rank]!]!.region = widgets[wOrder[rank]!]!;
  }
  return { options, ok: true };
}

async function main() {
  const cal = await prisma.setupSheetCalibration.findUnique({ where: { id: CAL_ID } });
  const rawData = cal!.calibrationDataJson as Record<string, unknown>;
  const data = normalizeCalibrationData(rawData);
  const oldImg = data.imageCalibration!;
  const mappings = (rawData.formFieldMappings ?? {}) as Record<string, { pdfFieldName?: string }>;
  const model = await prisma.setupSheetModel.findUnique({ where: { id: MODEL_ID } });
  const schema = parseSetupSheetModelSchema(model!.schemaJson);
  const labelByKey = new Map(schema?.fields.map((f) => [f.key, f.displayLabel] as const));
  const geo = await acroGeometry();

  // Flat list of every AcroForm checkbox widget — used to snap UNMAPPED multi-select groups
  // (schema groups that aggregate several separate 1-widget checkboxes, absent from formFieldMappings).
  const checkboxWidgets: WidgetRect[] = [];
  for (const acro of geo.values()) if (acro.kind === "checkbox") checkboxWidgets.push(...acro.widgets);
  const center = (r: ImageRegion) => ({ cx: r.xPct + r.wPct / 2, cy: r.yPct + r.hPct / 2 });
  function snapToNearestCheckbox(region: ImageRegion, cap = 0.05): WidgetRect | null {
    const c = center(region);
    let best: WidgetRect | null = null, bestD = Infinity;
    for (const w of checkboxWidgets) {
      const wc = center(w);
      const d = Math.hypot(wc.cx - c.cx, wc.cy - c.cy);
      if (d < bestD) { bestD = d; best = w; }
    }
    return best && bestD <= cap ? best : null;
  }

  const newFields: ImageCalibrationField[] = [];
  const warnings: string[] = [];
  for (const f of oldImg.fields) {
    const pdfName = mappings[f.key]?.pdfFieldName;
    const acro = pdfName ? geo.get(pdfName) : undefined;
    if (!acro) {
      // Unmapped group: snap each option to the nearest AcroForm checkbox widget + tune gate.
      if (f.kind === "singleChoiceGroup" || f.kind === "multiSelectGroup") {
        const opts = (f as { options: Array<{ value: string; region: ImageRegion }> }).options;
        let snapped = 0;
        const options = opts.map((o) => {
          const w = snapToNearestCheckbox(o.region);
          if (w) snapped++;
          return { ...o, region: w ?? o.region };
        });
        warnings.push(`unmapped_group_snapped:${f.key} ${snapped}/${opts.length}`);
        const base = { ...(f as object), options } as ImageCalibrationField;
        newFields.push(
          f.kind === "singleChoiceGroup"
            ? ({ ...base, minWinnerDarkness: 0.16, minMargin: 0.03 } as ImageCalibrationField)
            : ({ ...base, minWinnerDarkness: 0.16 } as ImageCalibrationField)
        );
        continue;
      }
      warnings.push(`no_acro_geometry:${f.key}(${pdfName ?? "unmapped"})`);
      newFields.push(f);
      continue;
    }

    if (f.kind === "text") {
      newFields.push({ ...f, region: expandText(acro.widgets[0]!) });
    } else if (f.kind === "checkbox") {
      newFields.push({ ...f, region: acro.widgets[0]! });
    } else {
      const existing = (f as { options: Array<{ value: string; region: ImageRegion }> }).options;
      const { options, ok } = pairOptions(existing, acro.widgets);
      if (!ok) warnings.push(`widget_count_mismatch:${f.key} existing=${existing.length} widgets=${acro.widgets.length}`);
      const base = { ...(f as object), options } as ImageCalibrationField;
      // Tighter AcroForm boxes give cleaner mark darkness; gates measured on the filled sheet.
      if (f.kind === "singleChoiceGroup") newFields.push({ ...base, minWinnerDarkness: 0.16, minMargin: 0.03 } as ImageCalibrationField);
      else newFields.push({ ...base, minWinnerDarkness: 0.16 } as ImageCalibrationField);
    }
  }

  const newImg: ImageCalibration = normalizeImageCalibration({ reference: oldImg.reference, fields: newFields })!;
  console.log(`Rebuilt imageCalibration: ${newImg.fields.length} regions. warnings=${warnings.length}`);
  for (const w of warnings) console.log("  " + w);

  const W = newImg.reference.widthPx, H = newImg.reference.heightPx;

  // ---- Overlay of NEW regions on the aligned filled image ----
  const filled = arg("filled");
  mkdirSync(RESULTS, { recursive: true });
  if (filled) {
    const aligned = await sharp(readFileSync(filled)).removeAlpha().resize(W, H, { fit: "fill" }).png().toBuffer();
    const rects: string[] = [];
    for (const f of newImg.fields) {
      const drawR = (r: ImageRegion, c: string) => rects.push(`<rect x="${(r.xPct*W).toFixed(1)}" y="${(r.yPct*H).toFixed(1)}" width="${(r.wPct*W).toFixed(1)}" height="${(r.hPct*H).toFixed(1)}" fill="none" stroke="${c}" stroke-width="2"/>`);
      if (f.kind === "text") drawR(f.region, "#1e90ff");
      else if (f.kind === "checkbox") drawR(f.region, "#00c853");
      else for (const o of (f as { options: Array<{ region: ImageRegion }> }).options) drawR(o.region, "#ff1744");
    }
    const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`);
    writeFileSync(join(RESULTS, "mtc3-overlay-new.png"), await sharp(aligned).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer());
    console.log(`Wrote ${join(RESULTS, "mtc3-overlay-new.png")}`);

    // ---- Offline test-read through NEW regions ----
    const apiKey = process.env.OPENAI_API_KEY!.trim();
    const px = (r: ImageRegion) => ({ left: Math.round(r.xPct*W), top: Math.round(r.yPct*H), width: Math.round(r.wPct*W), height: Math.round(r.hPct*H) });
    const darkness = async (r: ImageRegion) => {
      const p = px(r); if (p.width<=0||p.height<=0||p.left<0||p.top<0||p.left+p.width>W||p.top+p.height>H) return null;
      const { data: d, info } = await sharp(aligned).extract(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let s=0,c=0; for (let i=0;i<d.length;i+=info.channels){s+=((d[i]??0)+(d[i+1]??0)+(d[i+2]??0))/3;c++;} return c?1-s/c/255:0;
    };
    const textReq: Array<{ key: string; crop: Buffer }> = [];
    const rows: string[] = [];
    for (const f of newImg.fields) {
      if (f.kind === "text") { const p = px(f.region); if(p.width>0&&p.height>0&&p.left>=0&&p.top>=0&&p.left+p.width<=W&&p.top+p.height<=H) textReq.push({ key: f.key, crop: await sharp(aligned).extract(p).png().toBuffer() }); }
      else {
        const opts = (f as { options: Array<{ value: string; region: ImageRegion }> }).options;
        const sc: Array<{v:string;d:number}> = [];
        for (const o of opts){ const d = await darkness(o.region); if(d!=null) sc.push({v:o.value,d}); }
        sc.sort((a,b)=>b.d-a.d);
        const mw=(f as {minWinnerDarkness?:number}).minWinnerDarkness??0.45, mm=(f as {minMargin?:number}).minMargin??0.08;
        const pass = f.kind==="singleChoiceGroup" ? (sc[0]&&sc[0].d>=mw&&sc[0].d-(sc[1]?.d??0)>=mm) : sc.some(s=>s.d>=mw);
        rows.push(`${f.key.padEnd(24)} ${(labelByKey.get(f.key)||"").padEnd(20)} ${f.kind.padEnd(17)} [${mw}/${mm} ${pass?"PASS":"low"}] ${sc.map(s=>`${s.v}=${s.d.toFixed(3)}`).join(" ")}`);
      }
    }
    // batch OCR (chunks of 12 to reduce label mismap)
    const ocr: Record<string,string> = {};
    for (let c=0;c<textReq.length;c+=12){
      const chunk=textReq.slice(c,c+12); const comp:Array<{input:Buffer;top:number;left:number}>=[]; let y=0,mw=0;
      for(const r of chunk){const m=await sharp(r.crop).metadata();const w=m.width??0,h=m.height??0;
        comp.push({input:Buffer.from(`<svg width="${Math.max(220,w)}" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${r.key}]</text></svg>`),top:y,left:0});y+=26;comp.push({input:r.crop,top:y,left:0});y+=h+8;mw=Math.max(mw,w,220);}
      const sheet=await sharp({create:{width:Math.max(mw,220),height:Math.max(y,200),channels:3,background:{r:255,g:255,b:255}}}).composite(comp).png().toBuffer();
      const res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",temperature:0,response_format:{type:"json_object"},messages:[{role:"system",content:"Read cropped setup-sheet cells. Each cell is preceded by a [key] label. Return ONLY JSON mapping each key to the exact text below its label. Empty string if blank. Do not invent."},{role:"user",content:[{type:"text",text:`Keys: ${chunk.map(r=>r.key).join(", ")}.`},{type:"image_url",image_url:{url:`data:image/png;base64,${sheet.toString("base64")}`,detail:"high"}}]}]})});
      if(res.ok){const j=await res.json() as {choices?:Array<{message?:{content?:string}}>};try{const p=JSON.parse(j.choices?.[0]?.message?.content??"{}") as Record<string,unknown>;for(const[k,v]of Object.entries(p))ocr[k]=typeof v==="string"?v.trim():v==null?"":String(v).trim();}catch{}}
    }
    for(const r of textReq) rows.push(`${r.key.padEnd(24)} ${(labelByKey.get(r.key)||"").padEnd(20)} ${"text".padEnd(17)} "${ocr[r.key]??"(none)"}"`);
    rows.sort();
    console.log("\n" + rows.join("\n"));
    writeFileSync(join(RESULTS, `mtc3-newread-${Date.now()}.txt`), rows.join("\n"));
  }

  if (APPLY) {
    const merged = { ...rawData, imageCalibration: newImg };
    await prisma.setupSheetCalibration.update({ where: { id: CAL_ID }, data: { calibrationDataJson: merged as object } });
    console.log(`\nAPPLIED: updated calibration ${CAL_ID} imageCalibration (${newImg.fields.length} regions). Schema + PDF mapping untouched.`);
  } else {
    console.log("\nDry-run only. Re-run with --apply to write imageCalibration to the DB.");
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
