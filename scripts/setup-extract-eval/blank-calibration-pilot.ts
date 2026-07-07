/**
 * Stage 2A pilot (SETUP_UPLOAD_NORTH_STAR.md — blank-sheet anchor).
 *
 * Step 1: draft schema + ImageCalibration from a manufacturer's blank sheet
 *         (editable AcroForm PDF for geometry + raster blank as reference image).
 * Step 2 (--filled=<path>): read a real filled sheet through the drafted regions —
 *         darkness mark-detection for choice fields, batched crop-OCR for text —
 *         mirroring src/lib/setupCalibrations/imageExtractPipeline.ts (which is
 *         server-only and can't be imported from tsx) so thresholds can be tuned
 *         on data before wiring the app path.
 *
 * Usage:
 *   npm run setup-extract:blank-pilot                              # draft only
 *   npm run setup-extract:blank-pilot -- --filled=<path-to-png>    # draft (or reuse) + read
 *   npm run setup-extract:blank-pilot -- --redraft --filled=<path>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { draftCalibrationFromBlankSheet } from "@/lib/setupExtractAi/draftCalibrationFromBlankSheet";
import type { ImageCalibration, ImageRegion } from "@/lib/setupCalibrations/types";

const STYLE_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "gold", "xray-x4-2026");
const FILES_DIR = join(STYLE_DIR, "files");
const OUT_PATH = join(STYLE_DIR, "blank-calibration.json");
const RESULTS_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "results");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function regionToPixels(region: ImageRegion, widthPx: number, heightPx: number) {
  const left = Math.round(region.xPct * widthPx);
  const top = Math.round(region.yPct * heightPx);
  const width = Math.round(region.wPct * widthPx);
  const height = Math.round(region.hPct * heightPx);
  if (width <= 0 || height <= 0 || left < 0 || top < 0 || left + width > widthPx || top + height > heightPx) {
    return null;
  }
  return { left, top, width, height };
}

async function regionDarkness(aligned: Buffer, region: ImageRegion, widthPx: number, heightPx: number) {
  const px = regionToPixels(region, widthPx, heightPx);
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
  const CHUNK = 25;
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
        `<svg width="${Math.max(220, w)}" height="24" xmlns="http://www.w3.org/2000/svg">`
          + `<rect width="100%" height="100%" fill="white"/>`
          + `<text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${req.key}]</text></svg>`
      );
      composed.push({ input: labelSvg, top: y, left: 0 });
      y += 26;
      composed.push({ input: req.cropPng, top: y, left: 0 });
      y += h + 8;
      maxWidth = Math.max(maxWidth, w, 220);
    }
    const sheet = await sharp({
      create: { width: Math.max(maxWidth, 220), height: Math.max(y, 200), channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite(composed)
      .png()
      .toBuffer();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a JSON object mapping each key to the exact text content of the cell below its label. Empty string when blank/unreadable. Do not invent values.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Return JSON with keys: ${chunk.map((r) => r.key).join(", ")}.` },
              { type: "image_url", image_url: { url: `data:image/png;base64,${sheet.toString("base64")}`, detail: "high" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`  OCR chunk failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      continue;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    try {
      const parsed = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}") as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        out[k] = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
      }
    } catch {
      console.error("  OCR chunk returned unparseable JSON");
    }
  }
  return out;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set (run via npm script so .env.local loads).");
    process.exit(1);
  }

  let draft: { draftedSchema: unknown; imageCalibration: ImageCalibration; warnings: string[] };
  if (existsSync(OUT_PATH) && !process.argv.includes("--redraft")) {
    console.log(`Reusing existing draft: ${OUT_PATH} (pass --redraft to regenerate)`);
    draft = JSON.parse(readFileSync(OUT_PATH, "utf8"));
  } else {
    console.log("Drafting schema + calibration from the X4'26 blank sheet…");
    const t0 = Date.now();
    const result = await draftCalibrationFromBlankSheet({
      apiKey,
      editablePdfBytes: readFileSync(join(FILES_DIR, "x4_2026_set_up_editable_v02.pdf")),
      blankImageBytes: readFileSync(join(FILES_DIR, "x4_2026_set_up_blank.jpg")),
      blankImageMime: "image/jpeg",
      carName: "Xray X4'26",
    });
    console.log(
      `Drafted in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${result.draftedSchema.fields.length} fields `
        + `(${result.imageCalibration.fields.length} calibration regions, `
        + `${result.draftedSchema.universalMappedCount} universal), warnings: ${result.warnings.length}`
    );
    for (const w of result.warnings) console.log(`  warn: ${w}`);
    draft = result;
    writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
    console.log(`Wrote ${OUT_PATH}`);
  }

  const filledPath = arg("filled");
  if (!filledPath) return;

  console.log(`\nReading filled sheet: ${filledPath}`);
  const cal = draft.imageCalibration;
  const ref = cal.reference;
  const aligned = await sharp(readFileSync(filledPath))
    .removeAlpha()
    .resize(ref.widthPx, ref.heightPx, { fit: "fill" })
    .png()
    .toBuffer();

  const rows: Array<Record<string, unknown>> = [];
  const textRequests: Array<{ key: string; cropPng: Buffer }> = [];
  for (const field of cal.fields) {
    if (field.kind === "text") {
      const px = regionToPixels(field.region, ref.widthPx, ref.heightPx);
      if (!px) {
        rows.push({ key: field.key, kind: "text", error: "region_oob" });
        continue;
      }
      textRequests.push({ key: field.key, cropPng: await sharp(aligned).extract(px).png().toBuffer() });
    } else if (field.kind === "checkbox") {
      const darkness = await regionDarkness(aligned, field.region, ref.widthPx, ref.heightPx);
      rows.push({ key: field.key, kind: "checkbox", darkness: darkness?.toFixed(3) ?? "oob" });
    } else {
      const scores: Array<{ value: string; darkness: number }> = [];
      for (const opt of field.options) {
        const d = await regionDarkness(aligned, opt.region, ref.widthPx, ref.heightPx);
        if (d != null) scores.push({ value: opt.value, darkness: d });
      }
      scores.sort((a, b) => b.darkness - a.darkness);
      rows.push({
        key: field.key,
        kind: field.kind,
        winner: scores[0]?.value,
        scores: scores.map((s) => `${s.value}=${s.darkness.toFixed(3)}`).join(" "),
      });
    }
  }

  console.log(`OCR on ${textRequests.length} text crops…`);
  const ocr = await batchOcr(apiKey, textRequests);
  for (const req of textRequests) {
    rows.push({ key: req.key, kind: "text", value: ocr[req.key] ?? "(no result)" });
  }

  for (const row of rows) {
    const detail = row.kind === "text" ? `"${row.value ?? ""}"` : row.kind === "checkbox" ? `darkness=${row.darkness}` : `winner=${row.winner} [${row.scores}]`;
    console.log(`${String(row.key).padEnd(28)} ${String(row.kind).padEnd(18)} ${detail}`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, `blank-pilot-read-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(rows, null, 2));
  console.log(`\nWrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
