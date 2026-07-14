/** A/B an OCR prompt tweak on specific failing crops.
 *  npx tsx ... ocr-experiment.ts --case=case-02 --keys=camber_rear,toe_front,... */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration } from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const PROMPT_A =
  "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a single JSON object mapping each key to the exact text content of the cell below its label. Use empty string when unreadable. Do not invent values.";
const PROMPT_B =
  "You are reading cropped cells from a setup sheet. Each cell is preceded by a label like [key]. Return ONLY a single JSON object mapping each key to the exact text content of the cell below its label. Values often sit on a printed horizontal fill-in line; that line is part of the form, NOT part of the value — never read it as a minus sign or underscore. Only include a minus sign when a short dash glyph clearly precedes the digits. Ignore any partial glyph cut off at the crop edge. Use empty string when the cell is blank. Do not invent values.";

async function ocr(apiKey: string, prompt: string, reqs: Array<{ key: string; cropPng: Buffer }>): Promise<Record<string, string>> {
  const composed: Array<{ input: Buffer; top: number; left: number }> = [];
  let y = 0, maxWidth = 0;
  for (const r of reqs) {
    const meta = await sharp(r.cropPng).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0;
    composed.push({ input: Buffer.from(`<svg width="${Math.max(160, w)}" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="4" y="17" font-family="monospace" font-size="14" fill="black">[${r.key}]</text></svg>`), top: y, left: 0 });
    y += 26;
    composed.push({ input: r.cropPng, top: y, left: 0 });
    y += h + 8;
    maxWidth = Math.max(maxWidth, w, 160);
  }
  const sheet = await sharp({ create: { width: Math.max(maxWidth, 200), height: Math.max(y, 200), channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(composed).png().toBuffer();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: [
          { type: "text", text: `Return JSON with keys: ${reqs.map((r) => r.key).join(", ")}.` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${sheet.toString("base64")}`, detail: "high" } },
        ] },
      ],
    }),
  });
  if (!res.ok) return {};
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  try { return JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as Record<string, string>; } catch { return {}; }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const caseName = arg("case") ?? "case-02";
  const keys = (arg("keys") ?? "").split(",").filter(Boolean);
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  const gold = JSON.parse(readFileSync(join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "cases", `${caseName}.gold.json`), "utf8")) as { values: Record<string, string> };
  const jpg = readFileSync(join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "cases", `${caseName}.jpg`));
  const aligned = await sharp(jpg).removeAlpha().resize(ref.widthPx, ref.heightPx, { fit: "fill" }).png().toBuffer();

  const reqs: Array<{ key: string; cropPng: Buffer }> = [];
  for (const key of keys) {
    const f = live.imageCalibration.fields.find((x) => x.key === key && x.kind === "text") as { region: ImageRegion } | undefined;
    if (!f) continue;
    const px = { left: Math.round(f.region.xPct * ref.widthPx), top: Math.round(f.region.yPct * ref.heightPx), width: Math.round(f.region.wPct * ref.widthPx), height: Math.round(f.region.hPct * ref.heightPx) };
    reqs.push({ key, cropPng: await sharp(aligned).extract(px).png().toBuffer() });
  }
  const [a, b] = [await ocr(apiKey, PROMPT_A, reqs), await ocr(apiKey, PROMPT_B, reqs)];
  console.log(`${"key".padEnd(26)} ${"gold".padEnd(12)} ${"promptA".padEnd(12)} promptB`);
  for (const r of reqs) {
    console.log(`${r.key.padEnd(26)} ${String(gold.values[r.key] ?? "").padEnd(12)} ${String(a[r.key] ?? "").padEnd(12)} ${String(b[r.key] ?? "")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
