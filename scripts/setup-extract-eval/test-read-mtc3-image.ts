/**
 * Read a filled MTC3 image through the EXISTING image calibration (DB), mirroring
 * src/lib/setupCalibrations/imageExtractPipeline.ts (server-only, can't import from tsx).
 * READ-ONLY: no DB writes. Use to gauge current accuracy before tuning regions.
 *
 *   npm run setup-extract:test-read-mtc3 -- --filled="C:/Users/Jordan/Downloads/mugen test setup.jpg"
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

const CAL_ID = "cmpotp4qv0001l5043rtj9q70";
const MODEL_ID = "cmpor11xo0001jj04j420ik83";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function regionToPixels(region: ImageRegion, w: number, h: number) {
  const left = Math.round(region.xPct * w);
  const top = Math.round(region.yPct * h);
  const width = Math.round(region.wPct * w);
  const height = Math.round(region.hPct * h);
  if (width <= 0 || height <= 0 || left < 0 || top < 0 || left + width > w || top + height > h) return null;
  return { left, top, width, height };
}

async function regionDarkness(aligned: Buffer, region: ImageRegion, w: number, h: number) {
  const px = regionToPixels(region, w, h);
  if (!px) return null;
  const { data, info } = await sharp(aligned).extract(px).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    sum += (r + g + b) / 3;
    count++;
  }
  return count === 0 ? 0 : 1 - sum / count / 255;
}

async function batchOcr(apiKey: string, requests: Array<{ key: string; cropPng: Buffer }>) {
  const out: Record<string, string> = {};
  const CHUNK = Number(arg("chunk") ?? "25");
  for (let c = 0; c < requests.length; c += CHUNK) {
    const chunk = requests.slice(c, c + CHUNK);
    const composed: Array<{ input: Buffer; top: number; left: number }> = [];
    let y = 0;
    let maxWidth = 0;
    for (const req of chunk) {
      const meta = await sharp(req.cropPng).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const labelSvg = Buffer.from(
        `<svg width="${Math.max(220, w)}" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>` +
          `<text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${req.key}]</text></svg>`
      );
      composed.push({ input: labelSvg, top: y, left: 0 });
      y += 26;
      composed.push({ input: req.cropPng, top: y, left: 0 });
      y += h + 8;
      maxWidth = Math.max(maxWidth, w, 220);
    }
    const sheet = await sharp({
      create: { width: Math.max(maxWidth, 220), height: Math.max(y, 200), channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).composite(composed).png().toBuffer();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a JSON object mapping each key to the exact text content of the cell below its label. Empty string when blank/unreadable. Do not invent values." },
          { role: "user", content: [
            { type: "text", text: `Return JSON with keys: ${chunk.map((r) => r.key).join(", ")}.` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${sheet.toString("base64")}`, detail: "high" } },
          ] },
        ],
      }),
    });
    if (!res.ok) { console.error(`  OCR chunk failed: ${res.status}`); continue; }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    try {
      const parsed = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}") as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) out[k] = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    } catch { console.error("  OCR chunk unparseable"); }
  }
  return out;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) { console.error("OPENAI_API_KEY not set"); process.exit(1); }
  const filled = arg("filled");
  if (!filled) { console.error("Pass --filled=<path>"); process.exit(1); }

  const model = await prisma.setupSheetModel.findUnique({ where: { id: MODEL_ID } });
  const schema = parseSetupSheetModelSchema(model!.schemaJson);
  const labelByKey = new Map(schema?.fields.map((f) => [f.key, f.displayLabel] as const));
  const cal = await prisma.setupSheetCalibration.findUnique({ where: { id: CAL_ID } });
  const data = normalizeCalibrationData(cal!.calibrationDataJson);
  const img = data.imageCalibration!;
  const ref = img.reference;

  const kinds: Record<string, number> = {};
  for (const f of img.fields) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  console.log(`Calibration ${CAL_ID}: ${img.fields.length} regions`, kinds);
  console.log(`Reference ${ref.widthPx}x${ref.heightPx} aspect ${(ref.widthPx / ref.heightPx).toFixed(3)}, anchors=${ref.anchors?.length ?? 0}, pageRegion=${JSON.stringify(ref.pageRegion)}`);
  const schemaKeysNoRegion = (schema?.fields ?? []).filter((f) => !img.fields.some((r) => r.key === f.key)).map((f) => f.key);
  console.log(`Schema fields WITHOUT an image region (${schemaKeysNoRegion.length}): ${schemaKeysNoRegion.join(", ")}\n`);

  const aligned = await sharp(readFileSync(filled)).removeAlpha().resize(ref.widthPx, ref.heightPx, { fit: "fill" }).png().toBuffer();

  const rows: Array<{ key: string; label: string; kind: string; detail: string }> = [];
  const textReq: Array<{ key: string; cropPng: Buffer }> = [];
  for (const field of img.fields) {
    const label = labelByKey.get(field.key) ?? "";
    if (field.kind === "text") {
      const px = regionToPixels(field.region, ref.widthPx, ref.heightPx);
      if (!px) { rows.push({ key: field.key, label, kind: "text", detail: "REGION_OOB" }); continue; }
      textReq.push({ key: field.key, cropPng: await sharp(aligned).extract(px).png().toBuffer() });
    } else if (field.kind === "checkbox") {
      const d = await regionDarkness(aligned, field.region, ref.widthPx, ref.heightPx);
      const thr = (field as { threshold?: number }).threshold ?? 0.5;
      rows.push({ key: field.key, label, kind: "checkbox", detail: `dark=${d?.toFixed(3)} thr=${thr} -> ${d != null && d >= thr ? (field as { checkedValue?: string }).checkedValue ?? "1" : "(unchecked)"}` });
    } else {
      const opts = (field as { options: Array<{ value: string; region: ImageRegion }> }).options;
      const scores: Array<{ value: string; d: number }> = [];
      for (const o of opts) { const d = await regionDarkness(aligned, o.region, ref.widthPx, ref.heightPx); if (d != null) scores.push({ value: o.value, d }); }
      scores.sort((a, b) => b.d - a.d);
      const minWin = (field as { minWinnerDarkness?: number }).minWinnerDarkness ?? 0.45;
      const minMar = (field as { minMargin?: number }).minMargin ?? 0.08;
      const win = scores[0];
      const runner = scores[1]?.d ?? 0;
      const pass = field.kind === "singleChoiceGroup" ? (win && win.d >= minWin && win.d - runner >= minMar) : true;
      rows.push({ key: field.key, label, kind: field.kind, detail: `[gate ${minWin}/${minMar} ${pass ? "PASS" : "LOW-CONF"}] ${scores.map((s) => `${s.value}=${s.d.toFixed(3)}`).join(" ")}` });
    }
  }

  console.log(`OCR on ${textReq.length} text crops…`);
  const ocr = await batchOcr(apiKey, textReq);
  for (const r of textReq) rows.push({ key: r.key, label: labelByKey.get(r.key) ?? "", kind: "text", detail: `"${ocr[r.key] ?? "(no result)"}"` });

  rows.sort((a, b) => a.key.localeCompare(b.key));
  for (const r of rows) console.log(`${r.key.padEnd(24)} ${(r.label || "").padEnd(22)} ${r.kind.padEnd(17)} ${r.detail}`);

  const dir = join(process.cwd(), "scripts", "setup-extract-eval", "results");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `mtc3-test-read-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(rows, null, 2));
  // Also save the aligned image for visual inspection of box placement.
  writeFileSync(join(dir, "mtc3-aligned.png"), aligned);
  console.log(`\nWrote ${out}\nWrote ${join(dir, "mtc3-aligned.png")}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
