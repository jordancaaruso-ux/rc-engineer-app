import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, loadAcroGeometry, saveLiveImageCalibration, EDITABLE_PDF } from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

async function main() {
  const live = await loadLiveCalibration();
  const geo = await loadAcroGeometry(readFileSync(EDITABLE_PDF));
  const center = (r: ImageRegion) => ({ cx: r.xPct + r.wPct / 2, cy: r.yPct + r.hPct / 2 });
  for (const key of ["hex_width_front", "hex_width_rear"]) {
    const field = live.imageCalibration.fields.find((f) => f.key === key) as { options: Array<{ value: string; region: ImageRegion }> } | undefined;
    const pdfName = live.mappings[key]?.pdfFieldName;
    const acro = pdfName ? geo.get(pdfName) : undefined;
    if (!field || !acro) { console.log(`${key}: missing field/acro (${pdfName})`); continue; }
    console.log(`${key}: acro=${pdfName} widgets=${acro.widgets.length} options=${field.options.length}`);
    for (const opt of field.options) {
      const oc = center(opt.region);
      let best = acro.widgets[0]!, bestD = Infinity;
      for (const w of acro.widgets) {
        const wc = center(w.region);
        const d = Math.hypot(wc.cx - oc.cx, wc.cy - oc.cy);
        if (d < bestD) { bestD = d; best = w; }
      }
      console.log(`  option "${opt.value}": snapped to widget ${best.widgetIndex} (dist ${bestD.toFixed(4)})`);
      opt.region = best.region;
    }
  }
  if (process.argv.includes("--apply")) {
    await saveLiveImageCalibration(live.imageCalibration, live.rawData);
    console.log("APPLIED.");
  } else console.log("dry-run; --apply to write");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
