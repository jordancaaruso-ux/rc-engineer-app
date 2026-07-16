import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { loadLiveCalibration, readImageThroughCalibration } from "./mtc3-common";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const live = await loadLiveCalibration();
  const img = readFileSync(process.argv[2]!);
  const read = await readImageThroughCalibration(img, live.imageCalibration, apiKey, { skipOcr: true });
  const keys = ["traction", "active_fixed", "active_fixed_rear", "ackermann_plate_f_r", "arb_front", "arb_rear", "hex_width_front", "shock_orientation", "shock_orientation_rear", "layout", "track_surface", "uptravel_limit_measuring_method"];
  for (const k of keys) {
    const d = read.groupDetail[k];
    console.log(`${k.padEnd(28)} ${d ? `[${d.gate}] pass=${d.pass} ${d.scores.map((s) => `${s.value}=d${s.darkness.toFixed(3)}/r${((s as { redness?: number }).redness ?? 0).toFixed(3)}`).join(" ")}` : "(no detail)"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
