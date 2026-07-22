/**
 * Diagnostic: does the content box wobble between the blank (reference) render and a filled
 * render of the SAME pdf by the SAME rasterizer? A sub-pixel wobble shifts every field region
 * globally, which clips glyphs on one edge and pulls in neighbours on the other.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/diagnose-contentbox.ts --cal=<id> [--case=1]
 */
import { prisma } from "@/lib/prisma";
import { detectContentBox } from "@/lib/setupCalibrations/imageExtractPipeline";
import {
  loadCalibrationForVerify,
  loadAcroGeometry,
  fillSyntheticCase,
  renderPdfFirstPageToPng,
} from "./selfVerifyCore";

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const calId = arg("--cal");
  if (!calId) throw new Error("Pass --cal=<calibrationId>");
  const caseIndex = Number(arg("--case") ?? "1");

  const live = await loadCalibrationForVerify(calId);
  const geo = await loadAcroGeometry(live.blankPdfBytes);
  const ref = live.imageCalibration.reference;

  // Blank render, same path the derive step uses.
  const blankPng = await renderPdfFirstPageToPng(new Uint8Array(live.blankPdfBytes), { scale: 2 });
  const blankBox = await detectContentBox(blankPng);

  const filled = await fillSyntheticCase({ caseIndex, live, blankPdfBytes: live.blankPdfBytes, geo });
  const filledPng = await renderPdfFirstPageToPng(new Uint8Array(filled), { scale: 2 });
  const filledBox = await detectContentBox(filledPng);

  const fmt = (b: { xPct: number; yPct: number; wPct: number; hPct: number } | null) =>
    b ? `x=${b.xPct.toFixed(6)} y=${b.yPct.toFixed(6)} w=${b.wPct.toFixed(6)} h=${b.hPct.toFixed(6)}` : "NULL";

  console.log(`reference.contentBox : ${fmt(ref.contentBox ?? null)}`);
  console.log(`blank  render detect : ${fmt(blankBox)}`);
  console.log(`filled render detect : ${fmt(filledBox)}`);
  console.log(`reference dims       : ${ref.widthPx}x${ref.heightPx}`);

  if (ref.contentBox && filledBox) {
    const rb = ref.contentBox;
    const dx = (filledBox.xPct - rb.xPct) * ref.widthPx;
    const dy = (filledBox.yPct - rb.yPct) * ref.heightPx;
    const dw = (filledBox.wPct - rb.wPct) * ref.widthPx;
    const dh = (filledBox.hPct - rb.hPct) * ref.heightPx;
    console.log(`\ndelta filled vs reference (px): dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} dw=${dw.toFixed(2)} dh=${dh.toFixed(2)}`);
    const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
    const snaps =
      close(filledBox.xPct, rb.xPct) && close(filledBox.yPct, rb.yPct) &&
      close(filledBox.wPct, rb.wPct) && close(filledBox.hPct, rb.hPct);
    console.log(`identity-snap (0.005 tol) would fire: ${snaps ? "YES (plain resize)" : "NO (box-map resample)"}`);
  }

  // How much does a scale-2 render differ in raw pixel size from the reference canvas?
  const sharpMod = (await import("sharp")).default;
  const fm = await sharpMod(filledPng).metadata();
  console.log(`filled render dims   : ${fm.width}x${fm.height}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
