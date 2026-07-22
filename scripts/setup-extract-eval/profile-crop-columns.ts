/**
 * Why does removeFillInLines leave a border bar? Print the per-column dark fraction at both edges
 * of a crop, before and after cleaning, so we can see exactly where the edge-walk stops.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/profile-crop-columns.ts --cal=<id> --case=1 --keys=fdr,laps,respring
 */
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { removeFillInLines } from "@/lib/setupCalibrations/imageExtractPipeline";
import type { ImageRegion } from "@/lib/setupCalibrations/types";
import {
  loadCalibrationForVerify, loadAcroGeometry, fillSyntheticCase,
  extractGoldFromFilledPdf, renderPdfFirstPageToPng,
} from "./selfVerifyCore";

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function regionToPixels(r: ImageRegion, W: number, H: number) {
  return {
    left: Math.round(r.xPct * W), top: Math.round(r.yPct * H),
    width: Math.max(1, Math.round(r.wPct * W)), height: Math.max(1, Math.round(r.hPct * H)),
  };
}

/** Dark fraction per column at threshold `t`, plus the min luminance of each column. */
async function profile(buf: Buffer, t: number) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const frac: number[] = [];
  const minLum: number[] = [];
  for (let x = 0; x < width; x++) {
    let dark = 0, mn = 255;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * channels;
      const l = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      if (l < t) dark++;
      if (l < mn) mn = l;
    }
    frac.push(dark / height);
    minLum.push(mn);
  }
  return { frac, minLum, width, height };
}

async function main() {
  const calId = arg("--cal"); if (!calId) throw new Error("Pass --cal=<id>");
  const caseIndex = Number(arg("--case") ?? "1");
  const keys = (arg("--keys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const live = await loadCalibrationForVerify(calId);
  const geo = await loadAcroGeometry(live.blankPdfBytes);
  const filled = await fillSyntheticCase({ caseIndex, live, blankPdfBytes: live.blankPdfBytes, geo });
  const gold = await extractGoldFromFilledPdf(filled, live);
  const png = await renderPdfFirstPageToPng(new Uint8Array(filled), { scale: 2 });
  const m = await sharp(png).metadata(); const W = m.width!, H = m.height!;

  const N = 10;
  for (const key of keys) {
    const f = live.imageCalibration.fields.find((x) => x.key === key);
    if (!f || f.kind !== "text") { console.log(`${key}: not text`); continue; }
    const px = regionToPixels(f.region, W, H);
    const raw = await sharp(png).extract(px).png().toBuffer();
    const clean = await removeFillInLines(raw);
    const pr = await profile(raw, 140);
    const pc = await profile(clean, 140);
    const fmt = (a: number[], s: number, e: number) => a.slice(s, e).map((v) => v.toFixed(2).padStart(5)).join(" ");
    const fmtL = (a: number[], s: number, e: number) => a.slice(s, e).map((v) => String(Math.round(v)).padStart(5)).join(" ");
    console.log(`\n=== ${key}  gold="${String(gold.values[key] ?? "")}"  ${px.width}x${px.height} ===`);
    console.log(`RAW   darkfrac L[0..${N}] : ${fmt(pr.frac, 0, N)}`);
    console.log(`RAW   minLum   L[0..${N}] : ${fmtL(pr.minLum, 0, N)}`);
    console.log(`RAW   darkfrac R[-${N}..] : ${fmt(pr.frac, pr.width - N, pr.width)}`);
    console.log(`CLEAN darkfrac L[0..${N}] : ${fmt(pc.frac, 0, N)}`);
    console.log(`CLEAN darkfrac R[-${N}..] : ${fmt(pc.frac, pc.width - N, pc.width)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
